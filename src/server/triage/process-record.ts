import { createHash } from "node:crypto";

import type postgres from "postgres";
import { ZodError } from "zod";

import { newId } from "@/server/db/ids";
import { persistWebSources } from "@/server/research/web-captures";

import { IntegrationFailure, RecordFailure } from "./batch";
import type { DecisionValidationContext } from "./decision-validator";
import type { EvidencePacket } from "./model/types";
import type { DecisionOrchestrator, OrchestrationResult } from "./orchestrator";

type RecordInput = {
  id: string;
  sourceAppId: string;
  sourceSlug: string;
  sourceVersion: number;
  feedback: string;
  environment: string;
  route: string;
  screen: string;
  appVersion: string;
  sourceRevision: string;
};

type ResearchBundle = { evidencePacket: EvidencePacket; validationContext: DecisionValidationContext };

export type PersistedOutcome = {
  recordId: string;
  unitId: string;
  decisionId: string;
  disposition: "MERGED" | "CREATED" | "CONSIDERED";
  reasonCode: string;
  mutation: unknown;
  governedMetadata: unknown;
};

type Dependencies = {
  orchestrator: DecisionOrchestrator;
  research: { prepare(record: RecordInput): Promise<ResearchBundle> };
  outcomes: { apply(outcome: PersistedOutcome): Promise<void> };
  modelProfile: { provider: string; modelIdentifier: string; profileVersion: number; promptVersion: string; schemaVersion: string };
  systemPolicy: string;
};

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validationFailure(error: unknown): boolean {
  if (error instanceof ZodError) return true;
  return error instanceof Error && /(?:decision|evidence|mutation|unsafe|unit key|confidence|eligible|label|research finding)/i.test(error.message);
}

async function existingOutcomes(sql: postgres.Sql, recordId: string): Promise<{ total: number; attention: number; outcomes: PersistedOutcome[] }> {
  const [counts] = await sql<{ total: number; attention: number }[]>`
    select count(*)::int as total, count(*) filter (where state = 'NEEDS_ATTENTION')::int as attention
    from feedback_units where feedback_record_id = ${recordId}
  `;
  const outcomes = await sql<PersistedOutcome[]>`
    select ${recordId}::text as "recordId", fu.id as "unitId", td.id as "decisionId", td.disposition,
      td.reason_code as "reasonCode",
      td.proposed_payload as mutation, td.governed_metadata as "governedMetadata"
    from feedback_units fu join triage_decisions td on td.unit_id = fu.id and td.active
    where fu.feedback_record_id = ${recordId} and fu.state = 'APPLYING' and td.state in ('PRECONDITIONS_VALID', 'APPLYING', 'READBACK_CONFIRMED')
    order by fu.ordinal
  `;
  return { total: counts.total, attention: counts.attention, outcomes };
}

async function applyOutcomes(sql: postgres.Sql, outcomes: PersistedOutcome[], applier: Dependencies["outcomes"]): Promise<void> {
  for (const outcome of outcomes) {
    await sql`update triage_decisions set state = 'APPLYING' where id = ${outcome.decisionId} and state = 'PRECONDITIONS_VALID'`;
    await applier.apply(outcome);
    await sql.begin(async (tx) => {
      await tx`update triage_decisions set state = 'TERMINAL', terminal_at = coalesce(terminal_at, now()) where id = ${outcome.decisionId}`;
      await tx`update feedback_units set state = 'TERMINAL', terminal_at = coalesce(terminal_at, now()) where id = ${outcome.unitId}`;
    });
  }
}

async function persistPlan(
  sql: postgres.Sql,
  recordId: string,
  result: OrchestrationResult,
  profile: Dependencies["modelProfile"],
  evidenceManifestDigest: string,
): Promise<PersistedOutcome[]> {
  const plan = result.proposedDecision;
  const outcomes: PersistedOutcome[] = [];
  await sql.begin(async (tx) => {
    for (const [index, unit] of plan.units.entries()) {
      const unitId = newId();
      const decisionId = newId();
      const primaryRunId = newId();
      const reviewRunId = result.review ? newId() : null;
      await tx`
        insert into feedback_units (id, stable_key, feedback_record_id, ordinal, title, summary, kind_hint, split_reason, state)
        values (
          ${unitId}, ${digest(`${recordId}:${unit.unit_key}`)}, ${recordId}, ${index + 1}, ${unit.title}, ${unit.summary},
          ${unit.kind}, ${unit.split_reason ?? null}, ${result.status === "READY" ? "APPLYING" : "NEEDS_ATTENTION"}
        )
      `;
      await tx`
        insert into model_runs (
          id, unit_id, provider, model_identifier, profile_version, prompt_version, schema_version,
          evidence_manifest_digest, risk_review_reason, started_at, finished_at, input_tokens, output_tokens,
          response_id, validation_state, output_digest
        ) values (
          ${primaryRunId}, ${unitId}, ${profile.provider}, ${profile.modelIdentifier}, ${profile.profileVersion},
          ${profile.promptVersion}, ${profile.schemaVersion}, ${evidenceManifestDigest}, ${result.reviewReasons.join(",") || null},
          now(), now(), ${result.primary.usage.inputTokens}, ${result.primary.usage.outputTokens},
          ${result.primary.responseId}, 'VALIDATED', ${digest(result.primary.decision)}
        )
      `;
      if (result.review && reviewRunId) {
        await tx`
          insert into model_runs (
            id, unit_id, provider, model_identifier, profile_version, prompt_version, schema_version,
            evidence_manifest_digest, risk_review_reason, started_at, finished_at, input_tokens, output_tokens,
            response_id, validation_state, output_digest
          ) values (
            ${reviewRunId}, ${unitId}, ${profile.provider}, ${profile.modelIdentifier}, ${profile.profileVersion},
            ${profile.promptVersion}, ${profile.schemaVersion}, ${evidenceManifestDigest}, ${result.reviewReasons.join(",")},
            now(), now(), ${result.review.usage.inputTokens}, ${result.review.usage.outputTokens},
            ${result.review.responseId}, ${result.status === "READY" ? "VALIDATED" : "DISAGREED"}, ${digest(result.review.decision)}
          )
        `;
      }
      const governedMetadata = unit.mutation.kind === "CREATE_ISSUE" ? {
        typeLabel: unit.mutation.type_label,
        areaLabels: unit.mutation.area_labels,
        priority: unit.mutation.priority,
        impact: unit.mutation.impact,
        effort: unit.mutation.effort,
        status: "Backlog",
      } : null;
      await tx`
        insert into triage_decisions (
          id, unit_id, disposition, confidence, reason_code, rationale, evidence_ids, selected_issue_node_id,
          proposed_payload, governed_metadata, review_run_ids, state
        ) values (
          ${decisionId}, ${unitId}, ${unit.disposition}, ${unit.confidence}, ${unit.reason_code}, ${unit.rationale},
          ${tx.json(unit.evidence_ids)}, ${unit.mutation.kind === "MERGE_COMMENT" ? unit.mutation.issue_node_id : null},
          ${tx.json(unit.mutation as postgres.JSONValue)}, ${tx.json(governedMetadata)},
          ${tx.json(reviewRunId ? [reviewRunId] : [])}, ${result.status === "READY" ? "PRECONDITIONS_VALID" : "INVALID"}
        )
      `;
      if (result.status === "READY") outcomes.push({ recordId, unitId, decisionId, disposition: unit.disposition, reasonCode: unit.reason_code, mutation: unit.mutation, governedMetadata });
      await persistWebSources(tx, { unitId, sources: result.webSources });
    }
    await tx`update feedback_records set state = ${result.status === "READY" ? "APPLYING" : "NEEDS_ATTENTION"} where id = ${recordId}`;
  });
  return outcomes;
}

export async function processRecord(sql: postgres.Sql, recordId: string, dependencies: Dependencies): Promise<void> {
  const resume = await existingOutcomes(sql, recordId);
  if (resume.attention > 0) throw new RecordFailure("DECISION_NEEDS_ATTENTION");
  if (resume.total > 0) {
    await sql`update feedback_records set state = 'APPLYING' where id = ${recordId}`;
    await applyOutcomes(sql, resume.outcomes, dependencies.outcomes);
    return;
  }

  const record = await sql.begin(async (tx) => {
    const [row] = await tx<RecordInput[]>`
      select fr.id, fr.source_app_id as "sourceAppId", sa.slug as "sourceSlug", sa.version as "sourceVersion",
        fp.feedback_text as feedback, fr.environment, fr.route, fr.screen, fr.app_version as "appVersion",
        fr.source_revision as "sourceRevision"
      from feedback_records fr
      join feedback_payloads fp on fp.feedback_record_id = fr.id
      join source_apps sa on sa.id = fr.source_app_id
      where fr.id = ${recordId} and fr.state = 'LEASED' and sa.enabled and sa.paused_at is null
      for update of fr
    `;
    if (!row) throw new RecordFailure("FEEDBACK_RECORD_UNAVAILABLE");
    await tx`update feedback_records set state = 'RESEARCHING' where id = ${recordId}`;
    return row;
  });

  let research: ResearchBundle;
  try {
    research = await dependencies.research.prepare(record);
  } catch (error) {
    if (error instanceof RecordFailure) throw error;
    throw new IntegrationFailure("RESEARCH_INTEGRATION_FAILURE");
  }
  await sql`update feedback_records set state = 'DECIDING' where id = ${recordId} and state = 'RESEARCHING'`;

  let result: OrchestrationResult;
  try {
    result = await dependencies.orchestrator.decide({
      systemPolicy: dependencies.systemPolicy,
      evidencePacket: research.evidencePacket,
      validationContext: research.validationContext,
    });
  } catch (error) {
    if (validationFailure(error)) throw new RecordFailure("MODEL_OUTPUT_INVALID");
    throw new IntegrationFailure("MODEL_PROVIDER_FAILURE");
  }
  const manifestDigest = typeof research.evidencePacket.manifest === "object" && research.evidencePacket.manifest &&
    "digest" in research.evidencePacket.manifest && typeof research.evidencePacket.manifest.digest === "string"
    ? research.evidencePacket.manifest.digest
    : digest(research.evidencePacket);
  const outcomes = await persistPlan(sql, recordId, result, dependencies.modelProfile, manifestDigest);
  if (result.status !== "READY") throw new RecordFailure(result.failureCode ?? "DECISION_NEEDS_ATTENTION");
  await applyOutcomes(sql, outcomes, dependencies.outcomes);
}
