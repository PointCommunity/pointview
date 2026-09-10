import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findOrCreateAccount, updateAccount } from "@/server/accounts/service";
import { appendAuditEvent } from "@/server/audit/repository";
import { migrateDown, migrateUp } from "@/server/db/migrations";

const databaseUrl = process.env.DATABASE_TEST_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("account and audit persistence", () => {
  const sql = postgres(databaseUrl!, { max: 5 });

  beforeAll(async () => {
    await migrateDown(sql);
    await migrateUp(sql);
  });

  afterAll(async () => {
    await migrateDown(sql);
    await sql.end();
  });

  it("creates exactly one initial Owner under concurrent first login", async () => {
    const [first, second] = await Promise.all([
      findOrCreateAccount(sql, { subject: "subject-one", email: "one@example.test", displayName: "One" }, "h".repeat(32)),
      findOrCreateAccount(sql, { subject: "subject-two", email: "two@example.test", displayName: "Two" }, "h".repeat(32)),
    ]);
    expect([first, second].filter((account) => account.role === "OWNER" && account.status === "ACTIVE")).toHaveLength(1);
    expect([first, second].filter((account) => account.status === "PENDING")).toHaveLength(1);
  });

  it("prevents demotion of the final active Owner in the transaction", async () => {
    const [owner] = await sql<{ id: string; version: number }[]>`select id, version from accounts where role = 'OWNER'`;
    await expect(updateAccount(sql, {
      actorRole: "OWNER",
      accountId: owner.id,
      expectedVersion: owner.version,
      role: "ADMIN",
      status: "ACTIVE",
    })).rejects.toThrow(/final active Owner/);
  });

  it("audits an authorized optimistic account update", async () => {
    const [pending] = await sql<{ id: string; version: number }[]>`select id, version from accounts where status = 'PENDING'`;
    const [owner] = await sql<{ id: string }[]>`select id from accounts where role = 'OWNER'`;
    const updated = await updateAccount(sql, {
      actorRole: "OWNER", actorAccountId: owner.id,
      correlationId: "018f4f6d-7c00-7000-8000-000000000039",
      accountId: pending.id, expectedVersion: pending.version, role: "ADMIN", status: "ACTIVE",
    });
    expect(updated).toMatchObject({ role: "ADMIN", status: "ACTIVE", version: pending.version + 1 });
    const [event] = await sql<{ action: string; targetId: string }[]>`select action, target_id as "targetId" from audit_events where action = 'account.updated'`;
    expect(event).toEqual({ action: "account.updated", targetId: pending.id });
  });

  it("persists a hash-linked event and lets PostgreSQL reject mutation", async () => {
    const event = await appendAuditEvent(sql, {
      id: "018f4f6d-7c00-7000-8000-000000000031",
      eventAt: "2026-09-07T12:00:00.000Z",
      actorType: "SYSTEM",
      actorId: null,
      action: "migration.verified",
      targetType: "database",
      targetId: "pointview_test",
      result: "SUCCESS",
      correlationId: "018f4f6d-7c00-7000-8000-000000000032",
      safeMetadata: { version: "0001" },
    });
    expect(event.eventHash).toMatch(/^[0-9a-f]{64}$/);
    await expect(sql`update audit_events set result = 'FAILED' where id = ${event.id}`).rejects.toThrow(/append-only/);
  });
});
