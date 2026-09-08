import type postgres from "postgres";

import { IntegrationFailure, RecordFailure } from "@/server/triage/batch";
import { consideredMutationSchema, createMutationSchema, mergeMutationSchema } from "@/server/triage/decision-schema";
import type { PersistedOutcome } from "@/server/triage/process-record";

import { applyConsidered, applyCreate, applyMerge, type GitHubMutationPort } from "./apply-decision";
import { GitHubRateLimitError } from "./client";
import { PostgresOperationLedger } from "./operations";
import { assertMergePreconditions, assertProjectPreconditions } from "./preconditions";
import { renderCreatedIssue } from "./render-issue";
import { renderMergeComment } from "./render-merge";

type SourceTarget = {
  owner: string;
  repo: string;
  projectNodeId: string;
  projectNumber: number;
  installationId: number;
};

type OutcomeApplierOptions = {
  pointViewBaseUrl: string;
  portFor(target: SourceTarget): GitHubMutationPort;
};

export class GitHubOutcomeApplier {
  constructor(readonly sql: postgres.Sql, readonly options: OutcomeApplierOptions) {}

  async #target(recordId: string): Promise<SourceTarget> {
    const [target] = await this.sql<SourceTarget[]>`
      select sa.github_owner as owner, sa.github_repo as repo, sa.github_project_node_id as "projectNodeId",
        sa.github_project_number as "projectNumber", sa.github_installation_id::int as "installationId"
      from feedback_records fr join source_apps sa on sa.id = fr.source_app_id
      where fr.id = ${recordId} and sa.enabled and sa.paused_at is null
    `;
    if (!target.owner || !target.repo || !target.projectNodeId || !target.projectNumber || !target.installationId) {
      throw new RecordFailure("SOURCE_GITHUB_TARGET_UNAVAILABLE");
    }
    return target;
  }

  async apply(outcome: PersistedOutcome): Promise<void> {
    try {
      const target = await this.#target(outcome.recordId);
      const expectedRepository = `${target.owner}/${target.repo}`;
      const pointViewRecordUrl = new URL(`/feedback/${encodeURIComponent(outcome.recordId)}`, this.options.pointViewBaseUrl).toString();

      if (outcome.disposition === "CONSIDERED") {
        const mutation = consideredMutationSchema.parse(outcome.mutation);
        const ledger = new PostgresOperationLedger(this.sql, {
          decisionId: outcome.decisionId,
          step: "READBACK",
          target: { githubMutation: false },
          payload: mutation,
          preconditions: { disposition: "CONSIDERED" },
        });
        await applyConsidered({ decisionId: outcome.decisionId, operationId: outcome.decisionId, reasonCode: outcome.reasonCode }, ledger);
        return;
      }

      const port = this.options.portFor(target);

      if (outcome.disposition === "MERGED") {
        const mutation = mergeMutationSchema.parse(outcome.mutation);
        const preconditions = await port.readIssueByNodeId(mutation.issue_node_id);
        assertMergePreconditions(expectedRepository, preconditions);
        const [count] = await this.sql<{ value: number }[]>`
          select (count(*) + 1)::int as value from triage_decisions
          where selected_issue_node_id = ${mutation.issue_node_id} and id <> ${outcome.decisionId} and state = 'TERMINAL'
        `;
        const body = renderMergeComment({
          operationId: outcome.decisionId,
          feedbackCount: count.value,
          userEvidenceSummary: mutation.user_evidence_summary,
          researchFindings: mutation.research_findings.map((finding) => finding.text),
          scopeImpact: mutation.scope_impact,
          pointViewRecordUrl,
        });
        const ledger = new PostgresOperationLedger(this.sql, {
          decisionId: outcome.decisionId,
          step: "COMMENT",
          target: { repository: expectedRepository, issueNodeId: mutation.issue_node_id },
          payload: { body },
          preconditions,
        });
        await applyMerge({
          decisionId: outcome.decisionId,
          operationId: outcome.decisionId,
          targetIssueNodeId: mutation.issue_node_id,
          expectedRepository,
          body,
        }, port, ledger);
        return;
      }

      const mutation = createMutationSchema.parse(outcome.mutation);
      const fields = { status: "Backlog" as const, priority: mutation.priority, impact: mutation.impact, effort: mutation.effort };
      const labels = [mutation.type_label, ...mutation.area_labels];
      const expectation = {
        expectedRepository,
        expectedProject: { nodeId: target.projectNodeId, number: target.projectNumber },
        requiredLabels: labels,
        requiredFields: fields,
      };
      const preconditions = await port.readMutationPreconditions();
      assertProjectPreconditions(expectation, preconditions);
      const body = renderCreatedIssue({
        operationId: outcome.decisionId,
        summary: mutation.summary,
        userEvidence: mutation.user_evidence,
        researchFindings: mutation.research_findings.map((finding) => finding.text),
        scope: mutation.scope,
        acceptanceCriteria: mutation.acceptance_criteria,
        verification: mutation.verification,
        outOfScope: mutation.out_of_scope,
        pointViewRecordUrl,
      });
      const ledger = new PostgresOperationLedger(this.sql, {
        decisionId: outcome.decisionId,
        step: "CREATE_ISSUE",
        target: { repository: expectedRepository, projectNodeId: target.projectNodeId },
        payload: { title: mutation.title, body, labels, fields },
        preconditions,
      });
      await applyCreate({
        decisionId: outcome.decisionId,
        operationId: outcome.decisionId,
        title: mutation.title,
        body,
        labels,
        fields,
        expectedRepository,
        expectedProject: expectation.expectedProject,
      }, port, ledger);
    } catch (error) {
      if (error instanceof RecordFailure || error instanceof IntegrationFailure) throw error;
      if (error instanceof GitHubRateLimitError) throw new IntegrationFailure("GITHUB_RATE_LIMIT", error.retryAfterSeconds);
      if (error instanceof Error && /(?:drift|missing|not open|Done|private|label|field|readback|marker|eligible|repository)/i.test(error.message)) {
        throw new RecordFailure("GITHUB_PRECONDITION_OR_READBACK_FAILED");
      }
      throw new IntegrationFailure("GITHUB_INTEGRATION_FAILURE");
    }
  }
}
