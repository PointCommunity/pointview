import postgres from "postgres";

import { migrateDown, migrateUp } from "../src/server/db/migrations";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for browser fixtures");

const ids = {
  owner: "018f4f6d-7c00-7000-8000-000000000100",
  admin: "018f4f6d-7c00-7000-8000-000000000101",
  user: "018f4f6d-7c00-7000-8000-000000000102",
  pending: "018f4f6d-7c00-7000-8000-000000000103",
  source: "018f4f6d-7c00-7000-8000-000000000200",
  launchNew: "018f4f6d-7c00-7000-8000-000000000300",
  launchQueued: "018f4f6d-7c00-7000-8000-000000000301",
  launchAttention: "018f4f6d-7c00-7000-8000-000000000302",
  launchTriaged: "018f4f6d-7c00-7000-8000-000000000303",
  queued: "018f4f6d-7c00-7000-8000-000000000400",
  attention: "018f4f6d-7c00-7000-8000-000000000401",
  triaged: "018f4f6d-7c00-7000-8000-000000000402",
  unit: "018f4f6d-7c00-7000-8000-000000000500",
  capture: "018f4f6d-7c00-7000-8000-000000000600",
  run: "018f4f6d-7c00-7000-8000-000000000700",
  decision: "018f4f6d-7c00-7000-8000-000000000701",
  operation: "018f4f6d-7c00-7000-8000-000000000702",
  batch: "018f4f6d-7c00-7000-8000-000000000800",
  profile: "018f4f6d-7c00-7000-8000-000000000900",
};

const sql = postgres(databaseUrl, { max: 1 });
try {
  await migrateDown(sql);
  await migrateUp(sql);
  await sql`
    insert into accounts (id, access_subject_hash, email_normalized, display_name, role, status, approved_at)
    values
      (${ids.owner}, 'owner-subject', 'owner@example.test', 'Fixture Owner', 'OWNER', 'ACTIVE', now()),
      (${ids.admin}, 'admin-subject', 'admin@example.test', 'Fixture Admin', 'ADMIN', 'ACTIVE', now()),
      (${ids.user}, 'user-subject', 'user@example.test', 'Fixture User', 'USER', 'ACTIVE', now()),
      (${ids.pending}, 'pending-subject', 'pending@example.test', 'Pending Teammate', 'USER', 'PENDING', null)
  `;
  await sql`
    insert into source_apps (
      id, slug, display_name, enabled, github_owner, github_repo, github_project_node_id,
      github_project_number, github_installation_id, allowed_origins, return_url_prefixes,
      governed_labels, validation_status, validation_checked_at, validation_digest
    ) values (
      ${ids.source}, 'fixture-app', 'Fixture App', true, 'PointCommunity', 'fixture-app', 'PVT_fixture',
      7, 42, array['https://fixture.example.test'], array['https://fixture.example.test/'],
      array['type:bug','type:feature','type:maintenance','type:security','area:ui'], 'VALID', now(), 'fixture-validation-digest'
    )
  `;
  for (const [id, route, screen, consumed] of [
    [ids.launchNew, "/profile", "Profile settings", false],
    [ids.launchQueued, "/queue", "Queued feedback", true],
    [ids.launchAttention, "/attention", "Needs attention", true],
    [ids.launchTriaged, "/triaged", "Triaged feedback", true],
  ] as const) {
    await sql`
      insert into launch_sessions (
        id, source_app_id, account_id, environment, route, screen, app_version, source_revision,
        return_url, token_fingerprint, expires_at, consumed_at
      ) values (
        ${id}, ${ids.source}, ${ids.user}, 'canary', ${route}, ${screen}, '1.2.3', 'fixture-revision',
        'https://fixture.example.test/', ${`fingerprint-${id}`}, now() + interval '2 hours', ${consumed ? new Date() : null}
      )
    `;
  }
  for (const [id, launchId, state, text, correlationId] of [
    [ids.queued, ids.launchQueued, "QUEUED", "Please improve the queue controls.", "018f4f6d-7c00-7000-8000-000000000410"],
    [ids.attention, ids.launchAttention, "NEEDS_ATTENTION", "The report needs an operator decision.", "018f4f6d-7c00-7000-8000-000000000411"],
    [ids.triaged, ids.launchTriaged, "TRIAGED", "Profile validation should explain the required format.", "018f4f6d-7c00-7000-8000-000000000412"],
  ] as const) {
    await sql`
      insert into feedback_records (
        id, submitter_account_id, source_app_id, launch_session_id, environment, route, screen,
        app_version, source_revision, state, triage_terminal_at, raw_delete_after, correlation_id
      ) values (
        ${id}, ${ids.user}, ${ids.source}, ${launchId}, 'canary', '/profile', 'Profile settings',
        '1.2.3', 'fixture-revision', ${state},
        ${state === "TRIAGED" ? new Date() : null}, ${state === "TRIAGED" ? new Date(Date.now() + 180 * 86_400_000) : null},
        ${correlationId}
      )
    `;
    await sql`insert into feedback_payloads (feedback_record_id, feedback_text, policy_version, content_digest) values (${id}, ${text}, 'privacy-v1', ${`digest-${id}`})`;
  }
  await sql`
    insert into feedback_units (id, stable_key, feedback_record_id, ordinal, title, summary, kind_hint, state, terminal_at)
    values (${ids.unit}, 'fixture-unit', ${ids.triaged}, 1, 'Clarify profile validation', 'Explain the expected format.', 'BUG', 'TERMINAL', now())
  `;
  await sql`
    insert into research_captures (id, unit_id, kind, source_locator, title, publisher, applicability, facts, content_digest)
    values (${ids.capture}, ${ids.unit}, 'REPOSITORY', 'src/profile.ts', 'Profile validation source', 'PointCommunity/fixture-app', 'Shows the current validator.', ${sql.json({ revision: "fixture-revision", path: "src/profile.ts" })}, 'capture-digest')
  `;
  await sql`
    insert into model_runs (id, unit_id, provider, model_identifier, profile_version, prompt_version, schema_version, evidence_manifest_digest, started_at, finished_at, input_tokens, output_tokens, estimated_cost_micros, validation_state)
    values (${ids.run}, ${ids.unit}, 'OPENAI', 'fixture-model', 1, 'prompt-v1', '1.1.0', 'manifest-digest', now(), now(), 120, 40, 25, 'VALID')
  `;
  await sql`
    insert into triage_decisions (id, unit_id, disposition, confidence, reason_code, rationale, evidence_ids, state, terminal_at)
    values (${ids.decision}, ${ids.unit}, 'CONSIDERED', 0.91, 'INSUFFICIENT_SCOPE', 'The evidence does not yet justify a GitHub mutation.', ${sql.json([ids.capture])}, 'TERMINAL', now())
  `;
  await sql`
    insert into github_operations (id, decision_id, step, idempotency_key, target_digest, payload_digest, precondition_snapshot, state, readback_digest, readback_payload, readback_at)
    values (${ids.operation}, ${ids.decision}, 'READBACK', 'fixture-operation', 'target-digest', 'payload-digest', '{}'::jsonb, 'CONFIRMED', 'readback-digest', ${sql.json({ disposition: "CONSIDERED", mutation: false })}, now())
  `;
  await sql`
    insert into triage_batches (id, trigger_kind, scheduled_at, settings_version, runner_identity, state, finished_at, records_attempted, records_completed)
    values (${ids.batch}, 'SCHEDULED', now(), 1, 'fixture-runner', 'COMPLETED', now(), 1, 1)
  `;
  await sql`
    insert into model_profiles (
      id, provider, model_identifier, reasoning_effort, max_input_tokens, max_output_tokens, timeout_ms,
      active, secret_reference, prompt_version, prompt_digest, prompt_text, schema_version, schema_digest, schema_definition
    ) values (
      ${ids.profile}, 'OPENAI', 'fixture-model', 'medium', 100000, 8000, 120000, true,
      'op://pointview/openai/api-key', 'prompt-v1', 'prompt-digest', 'Fixture prompt', '1.1.0', 'schema-digest', ${sql.json({ type: "object" })}
    )
  `;
  await sql`update application_settings set model_profile_id = ${ids.profile} where version = 1`;
  process.stdout.write("PointView browser fixtures prepared.\n");
} finally {
  await sql.end();
}
