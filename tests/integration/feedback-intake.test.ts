import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFeedback, getFeedback, getLaunchContext, listFeedback, withdrawFeedback } from "@/server/feedback/service";
import { migrateDown, migrateUp } from "@/server/db/migrations";
import { newId } from "@/server/db/ids";
import { FileAttachmentStore } from "@/server/storage/file-store";
import { consumeVerifiedLaunch } from "@/server/launch/repository";

const databaseUrl = process.env.DATABASE_TEST_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("feedback intake persistence", () => {
  const sql = postgres(databaseUrl!, { max: 5 });
  let root = "";
  let accountId = "";
  let otherAccountId = "";
  let sourceAppId = "";

  beforeAll(async () => {
    await migrateDown(sql);
    await migrateUp(sql);
    root = await fs.mkdtemp(path.join(os.tmpdir(), "pointview-intake-"));
    accountId = newId();
    otherAccountId = newId();
    sourceAppId = newId();
    await sql`
      insert into accounts (id, access_subject_hash, email_normalized, display_name, role, status)
      values
        (${accountId}, ${"a".repeat(64)}, 'owner@example.test', 'Owner', 'OWNER', 'ACTIVE'),
        (${otherAccountId}, ${"b".repeat(64)}, 'user@example.test', 'User', 'USER', 'ACTIVE')
    `;
    await sql`
      insert into source_apps (
        id, slug, display_name, enabled, github_owner, github_repo, github_project_node_id,
        github_project_number, github_installation_id, allowed_origins, return_url_prefixes
      ) values (
        ${sourceAppId}, 'fixture', 'Fixture App', true, 'PointCommunity', 'fixture', 'PVT_fixture',
        1, 1, ${["https://fixture.test"]}, ${["https://fixture.test/"]}
      )
    `;
  });

  afterAll(async () => {
    await migrateDown(sql);
    await sql.end();
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  async function launch(forAccount = accountId) {
    const id = newId();
    await sql`
      insert into launch_sessions (
        id, source_app_id, account_id, environment, route, screen, app_version,
        source_revision, return_url, token_fingerprint, expires_at
      ) values (
        ${id}, ${sourceAppId}, ${forAccount}, 'canary', '/settings', 'Settings', '1.2.3',
        'abc123', 'https://fixture.test/settings', ${newId()}, now() + interval '30 minutes'
      )
    `;
    return id;
  }

  it("atomically consumes one launch nonce and creates a thirty-minute account-bound session", async () => {
    const now = new Date();
    const draft = {
      sourceApp: "fixture",
      environment: "canary" as const,
      location: "/settings",
      screenName: "Settings",
      appVersion: "1.2.3",
      sourceRevision: "abc123",
      returnUrl: "https://fixture.test/settings",
      nonce: "atomic-launch-nonce-at-least-twenty",
      issuedAt: new Date(now.getTime() - 1_000),
      expiresAt: new Date(now.getTime() + 299_000),
      tokenFingerprint: "f".repeat(64),
    };
    const launchSessionId = await consumeVerifiedLaunch(sql, {
      accountId,
      sourceSlug: "fixture",
      launch: draft,
      nonceSecret: "n".repeat(32),
    });
    expect(launchSessionId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(consumeVerifiedLaunch(sql, {
      accountId,
      sourceSlug: "fixture",
      launch: draft,
      nonceSecret: "n".repeat(32),
    })).resolves.toBeNull();
    const [session] = await sql<{ accountId: string; lifetimeSeconds: number }[]>`
      select account_id as "accountId", extract(epoch from (expires_at - created_at))::int as "lifetimeSeconds"
      from launch_sessions where id = ${launchSessionId}
    `;
    expect(session).toEqual({ accountId, lifetimeSeconds: 1800 });
  });

  it("creates exactly one queued record from one launch and stores normalized private images", async () => {
    const launchSessionId = await launch();
    const image = await sharp({ create: { width: 4, height: 3, channels: 3, background: "#38bdf8" } }).png().toBuffer();
    const store = new FileAttachmentStore(root);
    const context = await getLaunchContext(sql, { accountId, launchSessionId });
    expect(context).toMatchObject({ sourceApp: "Fixture App", route: "/settings", screen: "Settings" });

    const created = await createFeedback(sql, {
      accountId,
      launchSessionId,
      feedback: "  Please make this control easier to find.\r\nThanks!  ",
      privacyAcknowledged: true,
      screenshots: [{ bytes: image, name: "settings.png", mimeType: "image/png" }],
      policyVersion: "privacy-v1",
      store,
      scanner: { scan: async () => ({ status: "CLEAN" }) },
    });

    expect(created).toMatchObject({ state: "QUEUED", sourceApp: "Fixture App", attachmentCount: 1 });
    expect(created.feedback).toBe("Please make this control easier to find.\nThanks!");
    const [attachment] = await sql<{ storageKey: string }[]>`
      select storage_key as "storageKey" from attachments where feedback_record_id = ${created.id}
    `;
    await expect(store.exists(attachment.storageKey)).resolves.toBe(true);
    await expect(createFeedback(sql, {
      accountId,
      launchSessionId,
      feedback: "duplicate",
      privacyAcknowledged: true,
      screenshots: [],
      policyVersion: "privacy-v1",
      store,
      scanner: { scan: async () => ({ status: "CLEAN" }) },
    })).rejects.toMatchObject({ code: "LAUNCH_ALREADY_CONSUMED" });
  });

  it("enforces ownership for detail while operators can list all records", async () => {
    const [record] = await sql<{ id: string }[]>`select id from feedback_records order by sequence limit 1`;
    await expect(getFeedback(sql, { accountId: otherAccountId, role: "USER", status: "ACTIVE", feedbackId: record.id }))
      .rejects.toMatchObject({ code: "FEEDBACK_NOT_FOUND" });
    const own = await listFeedback(sql, { accountId, role: "OWNER", status: "ACTIVE", limit: 25 });
    expect(own.items.map((item) => item.id)).toContain(record.id);
  });

  it("compensates committed objects when the database transaction fails", async () => {
    const launchSessionId = await launch();
    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).png().toBuffer();
    const base = new FileAttachmentStore(root);
    let committedKey = "";
    const failingStore = {
      stage: async (bytes: Buffer) => {
        const staged = await base.stage(bytes);
        committedKey = staged.key;
        return {
          key: staged.key,
          abort: staged.abort,
          commit: async () => {
            await staged.commit();
            throw new Error("simulated storage acknowledgement loss");
          },
        };
      },
      delete: (key: string) => base.delete(key),
    };
    await expect(createFeedback(sql, {
      accountId,
      launchSessionId,
      feedback: "This should roll back",
      privacyAcknowledged: true,
      screenshots: [{ bytes: image, name: "failure.png", mimeType: "image/png" }],
      policyVersion: "privacy-v1",
      store: failingStore,
      scanner: { scan: async () => ({ status: "CLEAN" }) },
    })).rejects.toThrow(/acknowledgement loss/);
    await expect(base.exists(committedKey)).resolves.toBe(false);
    const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from feedback_records where launch_session_id = ${launchSessionId}`;
    expect(count).toBe(0);
  });

  it("withdraws only an owned queued and unleased record, erases bytes, and leaves an audit tombstone", async () => {
    const launchSessionId = await launch(otherAccountId);
    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#000" } }).png().toBuffer();
    const store = new FileAttachmentStore(root);
    const created = await createFeedback(sql, {
      accountId: otherAccountId,
      launchSessionId,
      feedback: "Withdraw this feedback",
      privacyAcknowledged: true,
      screenshots: [{ bytes: image, name: "withdraw.png", mimeType: "image/png" }],
      policyVersion: "privacy-v1",
      store,
      scanner: { scan: async () => ({ status: "CLEAN" }) },
    });
    const [attachment] = await sql<{ storageKey: string }[]>`
      select storage_key as "storageKey" from attachments where feedback_record_id = ${created.id}
    `;
    await expect(withdrawFeedback(sql, {
      accountId,
      role: "OWNER",
      status: "ACTIVE",
      feedbackId: created.id,
      correlationId: newId(),
      store,
    })).rejects.toMatchObject({ code: "FEEDBACK_NOT_FOUND" });
    await withdrawFeedback(sql, {
      accountId: otherAccountId,
      role: "USER",
      status: "ACTIVE",
      feedbackId: created.id,
      correlationId: newId(),
      store,
    });
    await expect(store.exists(attachment.storageKey)).resolves.toBe(false);
    const [record] = await sql<{ state: string; rawDeletedAt: Date | null }[]>`
      select state, raw_deleted_at as "rawDeletedAt" from feedback_records where id = ${created.id}
    `;
    expect(record).toMatchObject({ state: "WITHDRAWN", rawDeletedAt: expect.any(Date) });
    const [{ payloads }] = await sql<{ payloads: number }[]>`
      select count(*)::int as payloads from feedback_payloads where feedback_record_id = ${created.id}
    `;
    expect(payloads).toBe(0);
    const [event] = await sql<{ action: string; safeMetadata: Record<string, unknown> }[]>`
      select action, safe_metadata as "safeMetadata" from audit_events
      where target_id = ${created.id} and action = 'feedback.withdrawn'
    `;
    expect(event).toEqual({ action: "feedback.withdrawn", safeMetadata: { attachmentCount: 1 } });
  });
});
