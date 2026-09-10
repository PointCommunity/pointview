import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDown, migrateUp } from "@/server/db/migrations";
import { newId } from "@/server/db/ids";
import { PostgresOperationLedger } from "@/server/github/operations";
import { assertMergePreconditions, assertProjectPreconditions } from "@/server/github/preconditions";

const project = {
  nodeId: "PVT_expected",
  number: 4,
  public: false,
  repository: "PointCommunity/pointview",
  labels: ["type:feature", "area:feedback"],
  fields: {
    Status: ["Backlog", "On Hold", "In Progress", "In Review", "Done"],
    Priority: ["P0", "P1", "P2", "P3"],
    Impact: ["High", "Medium", "Low"],
    Effort: ["XS", "S", "M", "L", "XL"],
  },
};

describe("GitHub mutation preconditions", () => {
  it("rejects a moved or schema-drifted Project before a write", () => {
    expect(() => assertProjectPreconditions({
      expectedRepository: "PointCommunity/pointview",
      expectedProject: { nodeId: "PVT_expected", number: 4 },
      requiredLabels: ["type:feature", "area:feedback"],
      requiredFields: { status: "Backlog", priority: "P2", impact: "Medium", effort: "M" },
    }, { ...project, number: 5 })).toThrow(/identity drift/i);
    expect(() => assertProjectPreconditions({
      expectedRepository: "PointCommunity/pointview",
      expectedProject: { nodeId: "PVT_expected", number: 4 },
      requiredLabels: ["type:feature", "area:feedback"],
      requiredFields: { status: "Backlog", priority: "P2", impact: "Medium", effort: "M" },
    }, { ...project, fields: { ...project.fields, Priority: ["P0", "P1"] } })).toThrow(/Priority/i);
  });

  it("rejects closed, Done, missing, or cross-repository merge targets", () => {
    const valid = { nodeId: "I_target", number: 7, repository: "PointCommunity/pointview", state: "OPEN" as const, status: "In Progress" };
    expect(() => assertMergePreconditions("PointCommunity/pointview", null)).toThrow(/missing/i);
    expect(() => assertMergePreconditions("PointCommunity/pointview", { ...valid, state: "CLOSED" })).toThrow(/open/i);
    expect(() => assertMergePreconditions("PointCommunity/pointview", { ...valid, status: "Done" })).toThrow(/Done/i);
    expect(() => assertMergePreconditions("PointCommunity/other", valid)).toThrow(/repository/i);
    expect(() => assertMergePreconditions("PointCommunity/pointview", valid)).not.toThrow();
  });
});

const databaseUrl = process.env.DATABASE_TEST_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("PostgreSQL GitHub operation ledger", () => {
  const sql = postgres(databaseUrl!, { max: 3 });
  const ids = { account: newId(), source: newId(), launch: newId(), feedback: newId(), unit: newId(), decision: newId() };

  beforeAll(async () => {
    await migrateDown(sql);
    await migrateUp(sql);
    await sql`insert into accounts (id, access_subject_hash, email_normalized, display_name, role, status) values (${ids.account}, ${"a".repeat(64)}, 'ledger@example.test', 'Ledger', 'OWNER', 'ACTIVE')`;
    await sql`insert into source_apps (id, slug, display_name, enabled, github_owner, github_repo, github_project_node_id, github_project_number, github_installation_id, allowed_origins, return_url_prefixes)
      values (${ids.source}, 'ledger', 'Ledger', true, 'PointCommunity', 'pointview', 'PVT_expected', 4, 1, array['https://pointview.test'], array['https://pointview.test/'])`;
    await sql`insert into launch_sessions (id, source_app_id, account_id, environment, route, screen, app_version, source_revision, return_url, token_fingerprint, expires_at, consumed_at)
      values (${ids.launch}, ${ids.source}, ${ids.account}, 'test', '/', 'Home', '1', 'abc', 'https://pointview.test/', ${newId()}, now() + interval '5 minutes', now())`;
    await sql`insert into feedback_records (id, submitter_account_id, source_app_id, launch_session_id, environment, route, screen, app_version, source_revision, correlation_id)
      values (${ids.feedback}, ${ids.account}, ${ids.source}, ${ids.launch}, 'test', '/', 'Home', '1', 'abc', ${newId()})`;
    await sql`insert into feedback_units (id, stable_key, feedback_record_id, ordinal, title, summary, kind_hint, state) values (${ids.unit}, ${"b".repeat(64)}, ${ids.feedback}, 1, 'Ledger', 'Ledger', 'FEATURE', 'APPLYING')`;
    await sql`insert into triage_decisions (id, unit_id, disposition, confidence, reason_code, rationale, evidence_ids, proposed_payload, governed_metadata, review_run_ids, state)
      values (${ids.decision}, ${ids.unit}, 'CREATED', 0.9, 'NOVEL', 'Novel', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 'APPLYING')`;
  });

  afterAll(async () => {
    await migrateDown(sql);
    await sql.end();
  });

  it("survives process restart and rejects idempotency payload drift", async () => {
    const context = {
      decisionId: ids.decision,
      step: "CREATE_ISSUE" as const,
      target: { repository: "PointCommunity/pointview" },
      payload: { title: "Create" },
      preconditions: { project: "PVT_expected" },
    };
    const first = new PostgresOperationLedger(sql, context);
    await first.put({ key: `create:${ids.decision}`, state: "PENDING", githubIssueNumber: 12 });
    const restarted = new PostgresOperationLedger(sql, context);
    await expect(restarted.get(`create:${ids.decision}`)).resolves.toMatchObject({ state: "PENDING", githubIssueNumber: 12 });
    const drifted = new PostgresOperationLedger(sql, { ...context, payload: { title: "Changed" } });
    await expect(drifted.put({ key: `create:${ids.decision}`, state: "CONFIRMED" })).rejects.toThrow(/drift/i);
  });
});
