import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/server/db/ids";
import { migrateDown, migrateUp } from "@/server/db/migrations";
import { runRetention } from "@/server/retention/run";

const databaseUrl = process.env.DATABASE_TEST_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("raw feedback retention", () => {
  const sql = postgres(databaseUrl!, { max: 3 });
  const now = new Date("2026-09-07T12:00:00.000Z");
  const ids = { account: newId(), source: newId() };
  const objects = new Set<string>();
  let failKey: string | null = null;
  const store = {
    delete: async (key: string) => { if (key === failKey) throw new Error("object store unavailable"); objects.delete(key); },
    exists: async (key: string) => objects.has(key),
  };

  beforeAll(async () => {
    await migrateDown(sql);
    await migrateUp(sql);
    await sql`insert into accounts (id, access_subject_hash, email_normalized, display_name, role, status) values (${ids.account}, ${"a".repeat(64)}, 'retention@example.test', 'Retention', 'OWNER', 'ACTIVE')`;
    await sql`insert into source_apps (id, slug, display_name, github_owner, github_repo, github_project_node_id, github_project_number, github_installation_id, allowed_origins, return_url_prefixes)
      values (${ids.source}, 'retention', 'Retention', 'PointCommunity', 'pointview', 'PVT_expected', 4, 1, array['https://pointview.test'], array['https://pointview.test/'])`;
  });
  afterAll(async () => { await migrateDown(sql); await sql.end(); });

  async function seed(state: "TRIAGED" | "NEEDS_ATTENTION", suffix: string) {
    const launch = newId(); const feedback = newId(); const unit = newId(); const key = `${suffix}/${newId()}.bin`;
    await sql`insert into launch_sessions (id, source_app_id, account_id, environment, route, screen, app_version, source_revision, return_url, token_fingerprint, expires_at, consumed_at)
      values (${launch}, ${ids.source}, ${ids.account}, 'test', '/', 'Home', '1', 'abc', 'https://pointview.test/', ${newId()}, now() + interval '5 minutes', now())`;
    await sql`insert into feedback_records (id, submitter_account_id, source_app_id, launch_session_id, environment, route, screen, app_version, source_revision, correlation_id, state, triage_terminal_at, raw_delete_after)
      values (${feedback}, ${ids.account}, ${ids.source}, ${launch}, 'test', '/', 'Home', '1', 'abc', ${newId()}, ${state}, ${now}, ${new Date(now.getTime() - 1)})`;
    await sql`insert into feedback_payloads (feedback_record_id, feedback_text, policy_version, content_digest) values (${feedback}, 'private feedback', 'privacy-v1', ${"b".repeat(64)})`;
    await sql`insert into feedback_units (id, stable_key, feedback_record_id, ordinal, title, summary, kind_hint, state, terminal_at) values (${unit}, ${newId()}, ${feedback}, 1, 'Done', 'Done', 'OTHER', 'TERMINAL', ${now})`;
    await sql`insert into attachments (id, feedback_record_id, ordinal, display_name, mime_type, byte_size, width, height, sha256, storage_key, decode_status, scan_status)
      values (${newId()}, ${feedback}, 1, 'shot.png', 'image/png', 5, 1, 1, decode('00', 'hex'), ${key}, 'VALIDATED', 'CLEAN')`;
    objects.add(key);
    return { feedback, key };
  }

  it("deletes only eligible terminal content and is idempotent", async () => {
    const eligible = await seed("TRIAGED", "aa");
    const attention = await seed("NEEDS_ATTENTION", "bb");
    const first = await runRetention(sql, store, { now, correlationId: newId() });
    expect(first).toMatchObject({ selected: 1, deleted: 1, failed: 0, deletedBytes: 5 });
    expect(objects.has(eligible.key)).toBe(false);
    expect(objects.has(attention.key)).toBe(true);
    const [row] = await sql<{ deletedAt: Date | null; payload: number }[]>`
      select raw_deleted_at as "deletedAt", (select count(*)::int from feedback_payloads where feedback_record_id = ${eligible.feedback}) as payload
      from feedback_records where id = ${eligible.feedback}
    `;
    expect(row.deletedAt).toBeTruthy();
    expect(row.payload).toBe(0);
    await expect(runRetention(sql, store, { now })).resolves.toMatchObject({ selected: 0, deleted: 0 });
  });

  it("leaves the payload intact when object deletion fails, then retries", async () => {
    const candidate = await seed("TRIAGED", "cc");
    failKey = candidate.key;
    await expect(runRetention(sql, store, { now })).resolves.toMatchObject({ selected: 1, deleted: 0, failed: 1 });
    const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from feedback_payloads where feedback_record_id = ${candidate.feedback}`;
    expect(count).toBe(1);
    failKey = null;
    await expect(runRetention(sql, store, { now })).resolves.toMatchObject({ selected: 1, deleted: 1, failed: 0 });
  });
});
