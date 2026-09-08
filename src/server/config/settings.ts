import { createHash } from "node:crypto";

import type postgres from "postgres";
import { z } from "zod";

import { appendAuditEventInTransaction } from "@/server/audit/repository";
import { newId } from "@/server/db/ids";
import type { RequestAccount } from "@/server/feedback/service";

const settingsInput = z.object({
  triagePaused: z.boolean(),
  triagePauseReason: z.string().trim().min(1).max(500).nullable(),
  rawRetentionDays: z.number().int().min(180).max(3650),
  riskReviewPolicyVersion: z.string().trim().min(1).max(100),
  retrievalLimits: z.record(z.string(), z.number().int().positive().max(10_000_000)).refine((value) => Object.keys(value).length <= 30),
  promptVersion: z.string().trim().min(1).max(100),
  promptText: z.string().min(1).max(100_000),
  schemaVersion: z.string().trim().min(1).max(100),
  schemaText: z.string().min(1).max(200_000),
  model: z.object({
    provider: z.string().trim().min(1).max(80),
    modelIdentifier: z.string().trim().min(1).max(160),
    reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]),
    maxInputTokens: z.number().int().positive().max(2_000_000),
    maxOutputTokens: z.number().int().positive().max(200_000),
    timeoutMs: z.number().int().min(1_000).max(1_800_000),
    secretReference: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_./:-]{2,255}$/),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.triagePaused && !value.triagePauseReason) context.addIssue({ code: "custom", path: ["triagePauseReason"], message: "A pause reason is required" });
  if (!value.triagePaused && value.triagePauseReason) context.addIssue({ code: "custom", path: ["triagePauseReason"], message: "A pause reason is allowed only while paused" });
});

export class SettingsError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) { super(message); this.name = "SettingsError"; }
}

export type SettingsRecord = {
  version: number;
  triagePaused: boolean;
  triagePauseReason: string | null;
  observedSchedule: string;
  rawRetentionDays: number;
  riskReviewPolicyVersion: string;
  retrievalLimits: Record<string, number>;
  promptVersion: string;
  schemaVersion: string;
  model: null | {
    provider: string; modelIdentifier: string; reasoningEffort: string; maxInputTokens: number; maxOutputTokens: number;
    timeoutMs: number; secretReference: string; version: number;
  };
};

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }

export async function readSettings(sql: postgres.Sql, actor: RequestAccount): Promise<SettingsRecord> {
  if (actor.status !== "ACTIVE" || actor.role !== "OWNER") throw new SettingsError("ACCESS_DENIED", "Only an Owner may manage settings", 403);
  const [row] = await sql<(Omit<SettingsRecord, "model"> & { modelProfileId: string | null })[]>`
    select version, triage_paused as "triagePaused", triage_pause_reason as "triagePauseReason",
      observed_schedule as "observedSchedule", raw_retention_days as "rawRetentionDays",
      risk_review_policy_version as "riskReviewPolicyVersion", retrieval_limits as "retrievalLimits",
      prompt_version as "promptVersion", schema_version as "schemaVersion", model_profile_id as "modelProfileId"
    from application_settings where superseded_at is null order by version desc limit 1
  `;
  if (!row) throw new SettingsError("SETTINGS_UNAVAILABLE", "Application settings are unavailable", 503);
  if (!row.modelProfileId) return { ...row, model: null };
  const [model] = await sql<NonNullable<SettingsRecord["model"]>[]>`
    select provider, model_identifier as "modelIdentifier", reasoning_effort as "reasoningEffort",
      max_input_tokens as "maxInputTokens", max_output_tokens as "maxOutputTokens", timeout_ms as "timeoutMs",
      secret_reference as "secretReference", version from model_profiles where id = ${row.modelProfileId}
  `;
  return { ...row, model };
}

export async function updateSettings(sql: postgres.Sql, options: { actor: RequestAccount; expectedVersion: number; correlationId: string; input: unknown }): Promise<SettingsRecord> {
  if (options.actor.status !== "ACTIVE" || options.actor.role !== "OWNER") throw new SettingsError("ACCESS_DENIED", "Only an Owner may manage settings", 403);
  const parsed = settingsInput.safeParse(options.input);
  if (!parsed.success) throw new SettingsError("SETTINGS_INPUT_INVALID", parsed.error.issues.map((issue) => issue.message).join("; "), 400);
  await sql.begin(async (tx) => {
    const [current] = await tx<{ id: string; version: number; observedSchedule: string }[]>`
      select id, version, observed_schedule as "observedSchedule" from application_settings
      where superseded_at is null order by version desc limit 1 for update
    `;
    if (!current || current.version !== options.expectedVersion) throw new SettingsError("SETTINGS_VERSION_CONFLICT", "Settings version changed", 412);
    const input = parsed.data;
    const modelId = newId();
    await tx`update model_profiles set active = false, updated_at = now() where active`;
    const [{ count: modelVersion }] = await tx<{ count: number }[]>`select (count(*) + 1)::int as count from model_profiles`;
    await tx`
      insert into model_profiles (
        id, provider, model_identifier, reasoning_effort, max_input_tokens, max_output_tokens, timeout_ms,
        active, secret_reference, prompt_version, prompt_digest, schema_version, schema_digest, version
      ) values (
        ${modelId}, ${input.model.provider}, ${input.model.modelIdentifier}, ${input.model.reasoningEffort},
        ${input.model.maxInputTokens}, ${input.model.maxOutputTokens}, ${input.model.timeoutMs}, true,
        ${input.model.secretReference}, ${input.promptVersion}, ${sha256(input.promptText)}, ${input.schemaVersion},
        ${sha256(input.schemaText)}, ${modelVersion}
      )
    `;
    await tx`update application_settings set superseded_at = now() where id = ${current.id}`;
    await tx`
      insert into application_settings (
        id, version, triage_paused, triage_pause_reason, observed_schedule, raw_retention_days, model_profile_id,
        risk_review_policy_version, retrieval_limits, prompt_version, schema_version
      ) values (
        ${newId()}, ${current.version + 1}, ${input.triagePaused}, ${input.triagePauseReason}, ${current.observedSchedule},
        ${input.rawRetentionDays}, ${modelId}, ${input.riskReviewPolicyVersion}, ${tx.json(input.retrievalLimits)},
        ${input.promptVersion}, ${input.schemaVersion}
      )
    `;
    await appendAuditEventInTransaction(tx, {
      id: newId(), eventAt: new Date().toISOString(), actorType: "ACCOUNT", actorId: options.actor.accountId,
      action: "settings.updated", targetType: "application_settings", targetId: String(current.version + 1), result: "SUCCESS",
      correlationId: options.correlationId,
      safeMetadata: { version: current.version + 1, triagePaused: input.triagePaused, retentionDays: input.rawRetentionDays, modelIdentifier: input.model.modelIdentifier },
    });
  });
  return readSettings(sql, options.actor);
}
