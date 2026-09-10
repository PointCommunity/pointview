import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/server/db/ids";
import { migrateDown, migrateUp } from "@/server/db/migrations";
import type { GitHubIssueReadback, GitHubMutationPort } from "@/server/github/apply-decision";
import { GitHubOutcomeApplier } from "@/server/github/outcome-applier";
import type { PersistedOutcome } from "@/server/triage/process-record";

const databaseUrl = process.env.DATABASE_TEST_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

class FixturePort implements GitHubMutationPort {
  readonly calls: string[] = [];
  readonly comments: Array<{ id: string; issueNodeId: string; body: string }> = [];
  readonly issues: GitHubIssueReadback[] = [{
    nodeId: "I_existing", number: 10, title: "Existing", body: "Existing", state: "OPEN", assignees: [],
    labels: ["type:bug", "area:feedback"], projectItemId: "PVTI_10", status: "Backlog", priority: "P2",
    impact: "Medium", effort: "M", repository: "PointCommunity/pointview",
  }];

  async readMutationPreconditions() {
    this.calls.push("readMutationPreconditions");
    return {
      nodeId: "PVT_expected", number: 4, public: false, repository: "PointCommunity/pointview",
      labels: ["type:feature", "type:bug", "area:feedback"],
      fields: { Status: ["Backlog"], Priority: ["P2"], Impact: ["Medium"], Effort: ["M"] },
    };
  }
  async findIssueByMarker(marker: string) { return this.issues.find((issue) => issue.body.includes(marker)) ?? null; }
  async createIssue(input: { title: string; body: string }) {
    this.calls.push("createIssue");
    const issue: GitHubIssueReadback = {
      nodeId: `I_${this.issues.length}`, number: 11, title: input.title, body: input.body, state: "OPEN", assignees: [],
      labels: [], projectItemId: null, status: null, priority: null, impact: null, effort: null,
      repository: "PointCommunity/pointview",
    };
    this.issues.push(issue);
    return issue;
  }
  async setLabels(number: number, labels: string[]) { this.calls.push("setLabels"); this.issues.find((issue) => issue.number === number)!.labels = [...labels]; }
  async addToProject(number: number) { this.calls.push("addToProject"); const issue = this.issues.find((item) => item.number === number)!; issue.projectItemId = `PVTI_${number}`; return issue.projectItemId; }
  async setProjectFields(itemId: string, fields: { status: "Backlog"; priority: string; impact: string; effort: string }) {
    this.calls.push("setProjectFields");
    Object.assign(this.issues.find((issue) => issue.projectItemId === itemId)!, fields);
  }
  async readIssue(number: number) { return this.issues.find((issue) => issue.number === number)!; }
  async readIssueByNodeId(nodeId: string) { return this.issues.find((issue) => issue.nodeId === nodeId) ?? null; }
  async findCommentByMarker(issueNodeId: string, marker: string) { return this.comments.find((comment) => comment.issueNodeId === issueNodeId && comment.body.includes(marker)) ?? null; }
  async createComment(issueNodeId: string, body: string) { this.calls.push("createComment"); const comment = { id: `C_${this.comments.length + 1}`, issueNodeId, body }; this.comments.push(comment); return comment; }
  async readComment(id: string) { return this.comments.find((comment) => comment.id === id) ?? null; }
}

describeDatabase("durable GitHub outcome integration", () => {
  const sql = postgres(databaseUrl!, { max: 3 });
  const ids = { account: newId(), source: newId(), launch: newId(), feedback: newId() };

  beforeAll(async () => {
    await migrateDown(sql);
    await migrateUp(sql);
    await sql`insert into accounts (id, access_subject_hash, email_normalized, display_name, role, status) values (${ids.account}, ${"a".repeat(64)}, 'outcomes@example.test', 'Outcomes', 'OWNER', 'ACTIVE')`;
    await sql`insert into source_apps (id, slug, display_name, enabled, github_owner, github_repo, github_project_node_id, github_project_number, github_installation_id, allowed_origins, return_url_prefixes)
      values (${ids.source}, 'outcomes', 'Outcomes', true, 'PointCommunity', 'pointview', 'PVT_expected', 4, 1, array['https://pointview.test'], array['https://pointview.test/'])`;
    await sql`insert into launch_sessions (id, source_app_id, account_id, environment, route, screen, app_version, source_revision, return_url, token_fingerprint, expires_at, consumed_at)
      values (${ids.launch}, ${ids.source}, ${ids.account}, 'test', '/', 'Home', '1', 'abc', 'https://pointview.test/', ${newId()}, now() + interval '5 minutes', now())`;
    await sql`insert into feedback_records (id, submitter_account_id, source_app_id, launch_session_id, environment, route, screen, app_version, source_revision, correlation_id, state)
      values (${ids.feedback}, ${ids.account}, ${ids.source}, ${ids.launch}, 'test', '/', 'Home', '1', 'abc', ${newId()}, 'APPLYING')`;
  });

  afterAll(async () => { await migrateDown(sql); await sql.end(); });

  async function outcome(disposition: PersistedOutcome["disposition"], mutation: unknown, reasonCode: string): Promise<PersistedOutcome> {
    const unitId = newId();
    const decisionId = newId();
    const [{ count: ordinal }] = await sql<{ count: number }[]>`select (count(*) + 1)::int as count from feedback_units where feedback_record_id = ${ids.feedback}`;
    await sql`insert into feedback_units (id, stable_key, feedback_record_id, ordinal, title, summary, kind_hint, state, split_reason)
      values (${unitId}, ${newId()}, ${ids.feedback}, ${ordinal}, ${disposition}, ${disposition}, 'OTHER', 'APPLYING', ${ordinal > 1 ? "Outcome integration fixture" : null})`;
    await sql`insert into triage_decisions (id, unit_id, disposition, confidence, reason_code, rationale, evidence_ids, selected_issue_node_id, proposed_payload, governed_metadata, review_run_ids, state)
      values (${decisionId}, ${unitId}, ${disposition}, 0.9, ${reasonCode}, 'Fixture', '[]'::jsonb,
        ${disposition === "MERGED" ? "I_existing" : null}, ${sql.json(mutation as postgres.JSONValue)}, '{}'::jsonb, '[]'::jsonb, 'APPLYING')`;
    return { recordId: ids.feedback, unitId, decisionId, disposition, reasonCode, mutation, governedMetadata: {} };
  }

  it("applies Considered, Merged, and Created with durable readback and no broader authority", async () => {
    const port = new FixturePort();
    let portCreations = 0;
    const applier = new GitHubOutcomeApplier(sql, {
      pointViewBaseUrl: "https://pointview-canary.eaglepass.io",
      portFor: () => { portCreations += 1; return port; },
    });
    await applier.apply(await outcome("CONSIDERED", { kind: "NO_GITHUB_CHANGE", revisit_condition: "More evidence arrives." }, "INSUFFICIENT_EVIDENCE"));
    expect(portCreations).toBe(0);
    await applier.apply(await outcome("MERGED", {
      kind: "MERGE_COMMENT", issue_node_id: "I_existing", user_evidence_summary: "A user saw the failure.",
      research_findings: [{ text: "Existing scope matches.", evidence_ids: ["ev_issue_12345678"], source_urls: [] }], scope_impact: "Adds an occurrence.",
    }, "MATCHED_EXISTING_SCOPE"));
    await applier.apply(await outcome("CREATED", {
      kind: "CREATE_ISSUE", title: "Add upload recovery", summary: "Add upload recovery.", user_evidence: ["A user requested recovery."],
      research_findings: [{ text: "No current Issue covers it.", evidence_ids: ["ev_issue_12345678"], source_urls: [] }],
      scope: ["Add recovery."], acceptance_criteria: ["Recovery succeeds."], verification: ["Test an interrupted upload."], out_of_scope: [],
      type_label: "type:feature", area_labels: ["area:feedback"], priority: "P2", impact: "Medium", effort: "M",
    }, "NOVEL_ACTIONABLE_SCOPE"));
    expect(port.comments).toHaveLength(1);
    expect(port.issues).toHaveLength(2);
    expect(port.calls).not.toEqual(expect.arrayContaining(["closeIssue", "assignIssue", "setStatus", "createBranch", "createPullRequest", "deploy"]));
    const operations = await sql<{ state: string; readback: unknown }[]>`select state, readback_payload as readback from github_operations order by created_at`;
    expect(operations).toHaveLength(3);
    expect(operations.every((operation) => operation.state === "CONFIRMED" && operation.readback)).toBe(true);
  });
});
