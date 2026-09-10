import fs from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDown, migrateUp } from "@/server/db/migrations";

const databaseUrl = process.env.DATABASE_TEST_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("initial PostgreSQL migration", () => {
  const sql = postgres(databaseUrl!, { max: 1 });

  beforeAll(async () => {
    await migrateDown(sql);
    await migrateUp(sql);
  });

  afterAll(async () => {
    await migrateDown(sql);
    await sql.end();
  });

  it("creates the governed intake and triage tables", async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    `;
    const names = new Set(rows.map((row) => row.table_name));
    for (const table of [
      "accounts",
      "source_apps",
      "provider_connections",
      "feedback_records",
      "feedback_payloads",
      "feedback_leases",
      "feedback_units",
      "research_captures",
      "triage_decisions",
      "github_operations",
      "audit_events",
    ]) {
      expect(names.has(table), `missing ${table}`).toBe(true);
    }
  });

  it("enforces one active lease globally", async () => {
    const accountId = "018f4f6d-7c00-7000-8000-000000000001";
    const sourceId = "018f4f6d-7c00-7000-8000-000000000002";
    const launchId = "018f4f6d-7c00-7000-8000-000000000003";
    const first = "018f4f6d-7c00-7000-8000-000000000004";
    const second = "018f4f6d-7c00-7000-8000-000000000005";
    const batch = "018f4f6d-7c00-7000-8000-000000000006";

    await sql`insert into accounts (id, access_subject_hash, email_normalized, display_name, role, status)
      values (${accountId}, 'subject', 'owner@example.test', 'Owner', 'OWNER', 'ACTIVE')`;
    await sql`insert into source_apps (id, slug, display_name, github_owner, github_repo, github_project_node_id, github_project_number, github_installation_id, allowed_origins, return_url_prefixes)
      values (${sourceId}, 'fixture', 'Fixture', 'PointCommunity', 'fixture', 'PVT_fixture', 1, 1, array['https://fixture.test'], array['https://fixture.test/'])`;
    await sql`insert into launch_sessions (id, source_app_id, account_id, environment, route, screen, app_version, source_revision, return_url, token_fingerprint, expires_at)
      values (${launchId}, ${sourceId}, ${accountId}, 'test', '/', 'Fixture', '1.0.0', 'abc', 'https://fixture.test/', 'fingerprint', now() + interval '5 minutes')`;
    await sql`insert into feedback_records (id, submitter_account_id, source_app_id, launch_session_id, environment, route, screen, app_version, source_revision, correlation_id)
      values (${first}, ${accountId}, ${sourceId}, ${launchId}, 'test', '/', 'Fixture', '1.0.0', 'abc', '018f4f6d-7c00-7000-8000-000000000007')`;
    await sql`insert into launch_sessions (id, source_app_id, account_id, environment, route, screen, app_version, source_revision, return_url, token_fingerprint, expires_at)
      values ('018f4f6d-7c00-7000-8000-000000000008', ${sourceId}, ${accountId}, 'test', '/two', 'Fixture', '1.0.0', 'abc', 'https://fixture.test/', 'fingerprint-2', now() + interval '5 minutes')`;
    await sql`insert into feedback_records (id, submitter_account_id, source_app_id, launch_session_id, environment, route, screen, app_version, source_revision, correlation_id)
      values (${second}, ${accountId}, ${sourceId}, '018f4f6d-7c00-7000-8000-000000000008', 'test', '/two', 'Fixture', '1.0.0', 'abc', '018f4f6d-7c00-7000-8000-000000000009')`;
    await sql`insert into triage_batches (id, trigger_kind, scheduled_at, settings_version, runner_identity, state)
      values (${batch}, 'MANUAL', now(), 1, 'fixture', 'RUNNING')`;
    await sql`insert into feedback_leases (id, batch_id, feedback_record_id, attempt, idempotency_key, lease_owner, expires_at)
      values ('018f4f6d-7c00-7000-8000-000000000010', ${batch}, ${first}, 1, 'lease-one', 'fixture', now() + interval '5 minutes')`;

    await expect(sql`insert into feedback_leases (id, batch_id, feedback_record_id, attempt, idempotency_key, lease_owner, expires_at)
      values ('018f4f6d-7c00-7000-8000-000000000011', ${batch}, ${second}, 1, 'lease-two', 'fixture', now() + interval '5 minutes')`).rejects.toThrow();
  });

  it("keeps migration source files versioned", async () => {
    await expect(fs.readFile(path.join(process.cwd(), "migrations/0001_initial.sql"), "utf8")).resolves.toContain(
      "create table if not exists feedback_records",
    );
  });

  it("is safe to run again after the migration is recorded", async () => {
    await expect(migrateUp(sql)).resolves.toBeUndefined();
    const rows = await sql<{ version: string; digest: string }[]>`
      select version, digest from schema_migrations order by version
    `;
    expect(rows).toEqual([
      { version: "0001", digest: "pointview-initial-v1" },
      { version: "0002", digest: "pointview-provider-connections-v1" },
      { version: "0003", digest: "pointview-requeue-generations-v1" },
    ]);
  });
});
