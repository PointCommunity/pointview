import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/server/db/ids";
import { migrateDown, migrateUp } from "@/server/db/migrations";
import { PostgresDrainQueue } from "@/server/triage/postgres-queue";
import { requeueFeedback } from "@/server/triage/requeue";

const databaseUrl = process.env.DATABASE_TEST_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("audited feedback requeue", () => {
  const sql = postgres(databaseUrl!, { max: 3 });
  const ids = { owner: newId(), source: newId() };
  const actor = { accountId: ids.owner, role: "OWNER" as const, status: "ACTIVE" as const };

  beforeAll(async () => {
    await migrateDown(sql); await migrateUp(sql);
    await sql`insert into accounts (id, access_subject_hash, email_normalized, display_name, role, status) values (${ids.owner}, ${"a".repeat(64)}, 'requeue@example.test', 'Requeue', 'OWNER', 'ACTIVE')`;
    await sql`insert into source_apps (id, slug, display_name, github_owner, github_repo, github_project_node_id, github_project_number, github_installation_id, allowed_origins, return_url_prefixes)
      values (${ids.source}, 'requeue', 'Requeue', 'PointCommunity', 'pointview', 'PVT_expected', 4, 1, array['https://pointview.test'], array['https://pointview.test/'])`;
  });
  afterAll(async () => { await migrateDown(sql); await sql.end(); });

  async function seed(withInvalidDecision = false) {
    const launch = newId(); const feedback = newId();
    await sql`insert into launch_sessions (id, source_app_id, account_id, environment, route, screen, app_version, source_revision, return_url, token_fingerprint, expires_at, consumed_at)
      values (${launch}, ${ids.source}, ${ids.owner}, 'test', '/', 'Home', '1', 'abc', 'https://pointview.test/', ${newId()}, now() + interval '5 minutes', now())`;
    await sql`insert into feedback_records (id, submitter_account_id, source_app_id, launch_session_id, environment, route, screen, app_version, source_revision, correlation_id, state)
      values (${feedback}, ${ids.owner}, ${ids.source}, ${launch}, 'test', '/', 'Home', '1', 'abc', ${newId()}, 'NEEDS_ATTENTION')`;
    if (withInvalidDecision) {
      const unit = newId();
      await sql`insert into feedback_units (id, stable_key, feedback_record_id, ordinal, title, summary, kind_hint, state) values (${unit}, ${newId()}, ${feedback}, 1, 'Invalid', 'Invalid', 'OTHER', 'NEEDS_ATTENTION')`;
      await sql`insert into triage_decisions (id, unit_id, disposition, confidence, reason_code, rationale, evidence_ids, proposed_payload, governed_metadata, review_run_ids, state)
        values (${newId()}, ${unit}, 'CONSIDERED', 0.4, 'REVIEW_DISAGREED', 'Review disagreed', '[]'::jsonb, '{"kind":"NO_GITHUB_CHANGE","revisit_condition":null}'::jsonb, '{}'::jsonb, '[]'::jsonb, 'INVALID')`;
    }
    return feedback;
  }

  it("preserves sequence, records explanation, and retires an invalid decision generation", async () => {
    const feedback = await seed(true);
    const [before] = await sql<{ sequence: number }[]>`select sequence from feedback_records where id = ${feedback}`;
    const result = await requeueFeedback(sql, { actor, feedbackId: feedback, explanation: "Corrected the source mapping and reviewed the evidence.", correlationId: newId() });
    expect(result).toMatchObject({ state: "QUEUED", sequence: before.sequence, resumedOperation: false });
    const [decision] = await sql<{ active: boolean }[]>`select active from triage_decisions td join feedback_units fu on fu.id = td.unit_id where fu.feedback_record_id = ${feedback}`;
    expect(decision.active).toBe(false);
    const [annotation] = await sql<{ body: string }[]>`select body from feedback_annotations where feedback_record_id = ${feedback}`;
    expect(annotation.body).toMatch(/Corrected/);
  });

  it("rejects short explanations, wrong states, and active leases", async () => {
    const feedback = await seed();
    await expect(requeueFeedback(sql, { actor, feedbackId: feedback, explanation: "short", correlationId: newId() })).rejects.toThrow(/at least 10/i);
    await sql`update feedback_records set state = 'QUEUED' where id = ${feedback}`;
    await expect(requeueFeedback(sql, { actor, feedbackId: feedback, explanation: "Enough corrective context.", correlationId: newId() })).rejects.toThrow(/Needs Attention/i);
    await sql`update feedback_records set state = 'NEEDS_ATTENTION' where id = ${feedback}`;
    const batch = newId();
    await sql`insert into triage_batches (id, trigger_kind, scheduled_at, settings_version, runner_identity, state) values (${batch}, 'MANUAL', now(), 1, 'fixture', 'RUNNING')`;
    const lease = newId();
    await sql`insert into feedback_leases (id, batch_id, feedback_record_id, attempt, idempotency_key, lease_owner, expires_at) values (${lease}, ${batch}, ${feedback}, 1, ${newId()}, 'fixture', now() + interval '5 minutes')`;
    await expect(requeueFeedback(sql, { actor, feedbackId: feedback, explanation: "Enough corrective context.", correlationId: newId() })).rejects.toThrow(/active lease/i);
    await sql`update feedback_leases set released_at = now(), result = 'NEEDS_ATTENTION' where id = ${lease}`;
    await sql`update triage_batches set state = 'COMPLETED', finished_at = now(), stop_reason = 'QUEUE_EMPTY' where id = ${batch}`;
  });

  it("starts a fresh bounded-attempt cycle after an exhausted record is requeued", async () => {
    await sql`update feedback_records set state = 'TRIAGED', triage_terminal_at = now() where state = 'QUEUED'`;
    const feedback = await seed();
    for (const attempt of [1, 2, 3]) {
      const batch = newId();
      await sql`insert into triage_batches (id, trigger_kind, scheduled_at, settings_version, runner_identity, state, finished_at)
        values (${batch}, 'MANUAL', now(), 1, 'fixture', 'COMPLETED', now())`;
      await sql`insert into feedback_leases (id, batch_id, feedback_record_id, requeue_generation, attempt, idempotency_key, lease_owner, expires_at, released_at, result)
        values (${newId()}, ${batch}, ${feedback}, 1, ${attempt}, ${`feedback:${feedback}:generation:1:attempt:${attempt}`}, 'fixture', now() + interval '5 minutes', now(), 'NEEDS_ATTENTION')`;
    }

    const result = await requeueFeedback(sql, {
      actor,
      feedbackId: feedback,
      explanation: "The model schema was corrected and verified before retrying.",
      correlationId: newId(),
    });
    expect(result).toMatchObject({ state: "QUEUED", requeueGeneration: 2 });

    const queue = new PostgresDrainQueue(sql, "requeue-runner", 1, 60, 3);
    const batch = await queue.startBatch();
    expect(batch).toBeTruthy();
    const lease = await queue.leaseOldest(batch!);
    expect(lease?.recordId).toBe(feedback);
    const [persisted] = await sql<{ requeueGeneration: number; attempt: number; idempotencyKey: string }[]>`
      select requeue_generation as "requeueGeneration", attempt, idempotency_key as "idempotencyKey"
      from feedback_leases where id = ${lease!.leaseId}
    `;
    expect(persisted).toEqual({
      requeueGeneration: 2,
      attempt: 1,
      idempotencyKey: `feedback:${feedback}:generation:2:attempt:1`,
    });
    await queue.failLease(lease!.leaseId, lease!.recordId, "FIXTURE_FAILURE");
    await queue.finishBatch(batch!, "QUEUE_EMPTY", { completed: 0, needsAttention: 1 });
  });
});
