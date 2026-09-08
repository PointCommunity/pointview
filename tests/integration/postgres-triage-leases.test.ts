import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDown, migrateUp } from "@/server/db/migrations";
import { PostgresDrainQueue } from "@/server/triage/postgres-queue";

const databaseUrl = process.env.DATABASE_TEST_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("PostgreSQL triage leases", () => {
  const sql = postgres(databaseUrl!, { max: 4 });
  const ids = {
    account: "018f4f6d-7c00-7000-8000-000000000041",
    source: "018f4f6d-7c00-7000-8000-000000000042",
    launch1: "018f4f6d-7c00-7000-8000-000000000043",
    launch2: "018f4f6d-7c00-7000-8000-000000000044",
    first: "018f4f6d-7c00-7000-8000-000000000045",
    second: "018f4f6d-7c00-7000-8000-000000000046",
  };

  beforeAll(async () => {
    await migrateDown(sql);
    await migrateUp(sql);
    await sql`insert into accounts (id, access_subject_hash, email_normalized, display_name, role, status) values (${ids.account}, 'queue-subject', 'queue@example.test', 'Queue', 'OWNER', 'ACTIVE')`;
    await sql`insert into source_apps (id, slug, display_name, github_owner, github_repo, github_project_node_id, github_project_number, github_installation_id, allowed_origins, return_url_prefixes)
      values (${ids.source}, 'queue', 'Queue', 'PointCommunity', 'queue', 'PVT_queue', 1, 1, array['https://queue.test'], array['https://queue.test/'])`;
    for (const [launch, route, fingerprint] of [[ids.launch1, '/first', 'queue-one'], [ids.launch2, '/second', 'queue-two']]) {
      await sql`insert into launch_sessions (id, source_app_id, account_id, environment, route, screen, app_version, source_revision, return_url, token_fingerprint, expires_at)
        values (${launch}, ${ids.source}, ${ids.account}, 'test', ${route}, 'Queue', '1', 'abc', 'https://queue.test/', ${fingerprint}, now() + interval '5 minutes')`;
    }
    await sql`insert into feedback_records (id, submitter_account_id, source_app_id, launch_session_id, environment, route, screen, app_version, source_revision, correlation_id)
      values (${ids.first}, ${ids.account}, ${ids.source}, ${ids.launch1}, 'test', '/first', 'Queue', '1', 'abc', '018f4f6d-7c00-7000-8000-000000000047')`;
    await sql`insert into feedback_records (id, submitter_account_id, source_app_id, launch_session_id, environment, route, screen, app_version, source_revision, correlation_id)
      values (${ids.second}, ${ids.account}, ${ids.source}, ${ids.launch2}, 'test', '/second', 'Queue', '1', 'abc', '018f4f6d-7c00-7000-8000-000000000048')`;
  });

  afterAll(async () => {
    await migrateDown(sql);
    await sql.end();
  });

  it("leases oldest-first with one globally active lease", async () => {
    const queue = new PostgresDrainQueue(sql, "test-runner", 1, 60);
    const batch = await queue.startBatch();
    expect(batch).toBeTruthy();
    const first = await queue.leaseOldest(batch!);
    expect(first?.recordId).toBe(ids.first);
    await expect(queue.leaseOldest(batch!)).resolves.toBeNull();
    await queue.completeLease(first!.leaseId, first!.recordId);
    const second = await queue.leaseOldest(batch!);
    expect(second?.recordId).toBe(ids.second);
    await queue.failLease(second!.leaseId, second!.recordId, "FIXTURE_FAILURE");
    await queue.finishBatch(batch!, "QUEUE_EMPTY", { completed: 1, needsAttention: 1 });
    const states = await sql<{ id: string; state: string }[]>`select id, state from feedback_records order by sequence`;
    expect(states).toEqual([{ id: ids.first, state: "TRIAGED" }, { id: ids.second, state: "NEEDS_ATTENTION" }]);
  });
});
