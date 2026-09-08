import { createHash } from "node:crypto";

import type { JWK } from "jose";
import type postgres from "postgres";
import { z } from "zod";

import { appendAuditEventInTransaction } from "@/server/audit/repository";
import { newId } from "@/server/db/ids";
import type { RequestAccount } from "@/server/feedback/service";

const githubName = z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/);
const httpsOrigin = z.url().transform((value) => new URL(value)).refine(
  (url) => url.protocol === "https:" && url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password,
  "must be an exact HTTPS origin",
).transform((url) => url.origin);
const httpsPrefix = z.url().transform((value) => new URL(value)).refine(
  (url) => url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash,
  "must be an HTTPS URL prefix without credentials, query, or fragment",
).transform((url) => url.href);
const publicKey = z.object({
  kid: z.string().min(1).max(100),
  jwk: z.record(z.string(), z.unknown()).refine(
    (jwk) => jwk.kty === "OKP" && jwk.crv === "Ed25519" && typeof jwk.x === "string" && /^[A-Za-z0-9_-]{43}$/.test(jwk.x) && !("d" in jwk),
    "must be a public Ed25519 JWK",
  ),
  notBefore: z.iso.datetime(),
  notAfter: z.iso.datetime(),
}).refine((key) => new Date(key.notAfter) > new Date(key.notBefore), "key validity window is invalid");

export const sourceAppInputSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  displayName: z.string().trim().min(1).max(80),
  githubOwner: githubName,
  githubRepo: githubName,
  githubProjectNodeId: z.string().regex(/^PVT_[A-Za-z0-9_-]+$/),
  githubProjectNumber: z.number().int().positive(),
  githubInstallationId: z.number().int().positive(),
  allowedOrigins: z.array(httpsOrigin).min(1).max(20),
  returnUrlPrefixes: z.array(httpsPrefix).min(1).max(20),
  governedLabels: z.array(z.string().regex(/^(type|area):[a-z0-9][a-z0-9-]{0,49}$/)).min(5).max(100),
  publicKeys: z.array(publicKey).min(1).max(20),
}).superRefine((value, context) => {
  for (const [field, entries] of [["allowedOrigins", value.allowedOrigins], ["returnUrlPrefixes", value.returnUrlPrefixes], ["governedLabels", value.governedLabels]] as const) {
    if (new Set(entries).size !== entries.length) context.addIssue({ code: "custom", path: [field], message: "entries must be unique" });
  }
  if (new Set(value.publicKeys.map((key) => key.kid)).size !== value.publicKeys.length) {
    context.addIssue({ code: "custom", path: ["publicKeys"], message: "key IDs must be unique" });
  }
  for (const required of ["type:bug", "type:feature", "type:maintenance", "type:security"]) {
    if (!value.governedLabels.includes(required)) context.addIssue({ code: "custom", path: ["governedLabels"], message: `${required} is required` });
  }
  if (!value.governedLabels.some((label) => label.startsWith("area:"))) {
    context.addIssue({ code: "custom", path: ["governedLabels"], message: "at least one area label is required" });
  }
});

export type SourceAppInput = z.infer<typeof sourceAppInputSchema>;
export type SourceValidation = { valid: boolean; errors: string[]; digest?: string };
export type SourceAppRecord = SourceAppInput & {
  id: string;
  enabled: boolean;
  paused: boolean;
  version: number;
  validation: { status: "VALID" | "INVALID" | "UNKNOWN"; checkedAt: Date | null; digest: string | null };
};

export class SourceAppError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly errors: string[] = []) {
    super(message);
    this.name = "SourceAppError";
  }
}

function parseInput(input: unknown): SourceAppInput {
  const result = sourceAppInputSchema.safeParse(input);
  if (!result.success) throw new SourceAppError("SOURCE_INPUT_INVALID", "Source app configuration is invalid", 400, result.error.issues.map((issue) => issue.message));
  return result.data;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function keyFingerprint(jwk: Record<string, unknown>): string {
  return createHash("sha256").update(canonical(jwk)).digest("hex");
}

type SourceRow = Omit<SourceAppRecord, "publicKeys" | "validation"> & {
  validationStatus: "VALID" | "INVALID" | "UNKNOWN";
  validationCheckedAt: Date | null;
  validationDigest: string | null;
};

async function readSource(sql: postgres.Sql | postgres.TransactionSql, id: string): Promise<SourceAppRecord> {
  const [source] = await sql<SourceRow[]>`
    select id, slug, display_name as "displayName", github_owner as "githubOwner", github_repo as "githubRepo",
      github_project_node_id as "githubProjectNodeId", github_project_number as "githubProjectNumber",
      github_installation_id::int as "githubInstallationId", allowed_origins as "allowedOrigins",
      return_url_prefixes as "returnUrlPrefixes", governed_labels as "governedLabels", enabled,
      paused_at is not null as paused, version, validation_status as "validationStatus",
      validation_checked_at as "validationCheckedAt", validation_digest as "validationDigest"
    from source_apps where id = ${id}
  `;
  if (!source) throw new SourceAppError("SOURCE_NOT_FOUND", "Source app was not found", 404);
  const keys = await sql<{ kid: string; jwk: JWK; notBefore: Date; notAfter: Date }[]>`
    select kid, public_jwk as jwk, not_before as "notBefore", not_after as "notAfter"
    from source_app_keys where source_app_id = ${id} and revoked_at is null order by kid
  `;
  const { validationStatus, validationCheckedAt, validationDigest, ...record } = source;
  return {
    ...record,
    publicKeys: keys.map((key) => ({ ...key, notBefore: key.notBefore.toISOString(), notAfter: key.notAfter.toISOString() })),
    validation: { status: validationStatus, checkedAt: validationCheckedAt, digest: validationDigest },
  };
}

export async function createSourceApp(sql: postgres.Sql, options: { actor: RequestAccount; correlationId: string; input: unknown }): Promise<SourceAppRecord> {
  if (options.actor.status !== "ACTIVE" || options.actor.role !== "OWNER") throw new SourceAppError("ACCESS_DENIED", "Only an Owner may manage source apps", 403);
  const input = parseInput(options.input);
  const id = newId();
  try {
    return await sql.begin(async (tx) => {
      await tx`
        insert into source_apps (
          id, slug, display_name, enabled, github_owner, github_repo, github_project_node_id,
          github_project_number, github_installation_id, allowed_origins, return_url_prefixes, governed_labels
        ) values (
          ${id}, ${input.slug}, ${input.displayName}, false, ${input.githubOwner}, ${input.githubRepo},
          ${input.githubProjectNodeId}, ${input.githubProjectNumber}, ${input.githubInstallationId},
          ${input.allowedOrigins}, ${input.returnUrlPrefixes}, ${input.governedLabels}
        )
      `;
      for (const key of input.publicKeys) {
        await tx`
          insert into source_app_keys (id, source_app_id, kid, public_jwk, fingerprint, not_before, not_after)
          values (${newId()}, ${id}, ${key.kid}, ${tx.json(key.jwk as postgres.JSONValue)}, ${keyFingerprint(key.jwk)}, ${key.notBefore}, ${key.notAfter})
        `;
      }
      await appendAuditEventInTransaction(tx, {
        id: newId(), eventAt: new Date().toISOString(), actorType: "ACCOUNT", actorId: options.actor.accountId,
        action: "source_app.created", targetType: "source_app", targetId: id, result: "SUCCESS",
        correlationId: options.correlationId, safeMetadata: { slug: input.slug, enabled: false, version: 1 },
      });
      return readSource(tx, id);
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      throw new SourceAppError("SOURCE_CONFLICT", "A source app with this identifier already exists", 409);
    }
    throw error;
  }
}

export async function updateSourceApp(sql: postgres.Sql, options: {
  actor: RequestAccount;
  sourceAppId: string;
  expectedVersion: number;
  input: unknown;
  correlationId: string;
  validateTarget: (input: SourceAppInput) => Promise<SourceValidation>;
}): Promise<SourceAppRecord> {
  if (options.actor.status !== "ACTIVE" || options.actor.role !== "OWNER") throw new SourceAppError("ACCESS_DENIED", "Only an Owner may manage source apps", 403);
  const raw = z.object({ enabled: z.boolean(), paused: z.boolean() }).and(sourceAppInputSchema).safeParse(options.input);
  if (!raw.success) throw new SourceAppError("SOURCE_INPUT_INVALID", "Source app configuration is invalid", 400, raw.error.issues.map((issue) => issue.message));
  const input = raw.data;
  const [observed] = await sql<{ slug: string; version: number }[]>`
    select slug, version from source_apps where id = ${options.sourceAppId}
  `;
  if (!observed) throw new SourceAppError("SOURCE_NOT_FOUND", "Source app was not found", 404);
  if (observed.version !== options.expectedVersion) throw new SourceAppError("SOURCE_VERSION_CONFLICT", "Source app version changed", 412);
  if (observed.slug !== input.slug) throw new SourceAppError("SOURCE_SLUG_IMMUTABLE", "Source app identifier cannot change", 409);
  const validation = input.enabled ? await options.validateTarget(input) : { valid: false, errors: [] };
  if (input.enabled && !validation.valid) throw new SourceAppError("SOURCE_TARGET_INVALID", "Source app target validation failed", 409, validation.errors);
  return sql.begin(async (tx) => {
    const [current] = await tx<{ slug: string; version: number; githubOwner: string; githubRepo: string; githubProjectNodeId: string }[]>`
      select slug, version, github_owner as "githubOwner", github_repo as "githubRepo", github_project_node_id as "githubProjectNodeId"
      from source_apps where id = ${options.sourceAppId} for update
    `;
    if (!current) throw new SourceAppError("SOURCE_NOT_FOUND", "Source app was not found", 404);
    if (current.version !== options.expectedVersion) throw new SourceAppError("SOURCE_VERSION_CONFLICT", "Source app version changed", 412);
    if (current.slug !== input.slug) throw new SourceAppError("SOURCE_SLUG_IMMUTABLE", "Source app identifier cannot change", 409);
    const targetChanged = current.githubOwner !== input.githubOwner || current.githubRepo !== input.githubRepo || current.githubProjectNodeId !== input.githubProjectNodeId;
    if (targetChanged) {
      const [{ count }] = await tx<{ count: number }[]>`
        select count(*)::int as count from feedback_records
        where source_app_id = ${options.sourceAppId} and state not in ('TRIAGED', 'NEEDS_ATTENTION', 'WITHDRAWN')
      `;
      if (count > 0) throw new SourceAppError("SOURCE_TARGET_IN_USE", "Source target cannot change while feedback is active", 409);
    }
    await tx`
      update source_apps set display_name = ${input.displayName}, enabled = ${input.enabled}, github_owner = ${input.githubOwner},
        github_repo = ${input.githubRepo}, github_project_node_id = ${input.githubProjectNodeId},
        github_project_number = ${input.githubProjectNumber}, github_installation_id = ${input.githubInstallationId},
        allowed_origins = ${input.allowedOrigins}, return_url_prefixes = ${input.returnUrlPrefixes}, governed_labels = ${input.governedLabels},
        paused_at = ${input.paused ? new Date() : null}, pause_reason = ${input.paused ? "Owner paused" : null},
        validation_status = ${input.enabled ? "VALID" : "UNKNOWN"}, validation_checked_at = ${input.enabled ? new Date() : null},
        validation_digest = ${input.enabled ? validation.digest ?? null : null}, version = version + 1, updated_at = now()
      where id = ${options.sourceAppId}
    `;
    const activeKids = input.publicKeys.map((key) => key.kid);
    await tx`update source_app_keys set revoked_at = now() where source_app_id = ${options.sourceAppId} and revoked_at is null and not (kid = any(${activeKids}))`;
    for (const key of input.publicKeys) {
      const fingerprint = keyFingerprint(key.jwk);
      const [existing] = await tx<{ fingerprint: string }[]>`
        select fingerprint from source_app_keys where source_app_id = ${options.sourceAppId} and kid = ${key.kid}
      `;
      if (existing && existing.fingerprint !== fingerprint) throw new SourceAppError("SOURCE_KEY_CONFLICT", "An existing key ID cannot be reused", 409);
      if (!existing) {
        await tx`
          insert into source_app_keys (id, source_app_id, kid, public_jwk, fingerprint, not_before, not_after)
          values (${newId()}, ${options.sourceAppId}, ${key.kid}, ${tx.json(key.jwk as postgres.JSONValue)}, ${fingerprint}, ${key.notBefore}, ${key.notAfter})
        `;
      } else {
        await tx`update source_app_keys set revoked_at = null, not_before = ${key.notBefore}, not_after = ${key.notAfter} where source_app_id = ${options.sourceAppId} and kid = ${key.kid}`;
      }
    }
    await appendAuditEventInTransaction(tx, {
      id: newId(), eventAt: new Date().toISOString(), actorType: "ACCOUNT", actorId: options.actor.accountId,
      action: "source_app.updated", targetType: "source_app", targetId: options.sourceAppId, result: "SUCCESS",
      correlationId: options.correlationId,
      safeMetadata: { slug: input.slug, enabled: input.enabled, paused: input.paused, version: options.expectedVersion + 1 },
    });
    return readSource(tx, options.sourceAppId);
  });
}

export async function listSourceApps(sql: postgres.Sql, actor: RequestAccount): Promise<SourceAppRecord[]> {
  if (actor.status !== "ACTIVE" || actor.role !== "OWNER") throw new SourceAppError("ACCESS_DENIED", "Only an Owner may manage source apps", 403);
  const ids = await sql<{ id: string }[]>`select id from source_apps order by display_name, id`;
  return Promise.all(ids.map(({ id }) => readSource(sql, id)));
}

export async function listSourceAppHistory(sql: postgres.Sql, actor: RequestAccount) {
  if (actor.status !== "ACTIVE" || actor.role !== "OWNER") throw new SourceAppError("ACCESS_DENIED", "Only an Owner may manage source apps", 403);
  return sql<Array<{ id: string; sourceAppId: string; action: string; eventAt: Date; metadata: unknown }>>`
    select id, target_id as "sourceAppId", action, event_at as "eventAt", safe_metadata as metadata
    from audit_events where target_type = 'source_app' order by event_at desc, id desc limit 500
  `;
}
