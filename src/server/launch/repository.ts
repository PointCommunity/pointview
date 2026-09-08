import { createHmac } from "node:crypto";

import type { JWK } from "jose";
import type postgres from "postgres";

import { newId } from "@/server/db/ids";
import { appendAuditEventInTransaction } from "@/server/audit/repository";

import type { RegisteredLaunchSource, VerifiedLaunchDraft } from "./verify";

export async function findRegisteredLaunchSource(sql: postgres.Sql, slug: string): Promise<RegisteredLaunchSource | undefined> {
  const [source] = await sql<{
    id: string;
    slug: string;
    enabled: boolean;
    paused: boolean;
    allowedOrigins: string[];
    returnUrlPrefixes: string[];
  }[]>`
    select id, slug, enabled, paused_at is not null as paused,
      allowed_origins as "allowedOrigins", return_url_prefixes as "returnUrlPrefixes"
    from source_apps where slug = ${slug}
  `;
  if (!source) return undefined;
  const keys = await sql<{
    kid: string;
    publicJwk: JWK;
    notBefore: Date;
    notAfter: Date;
    revokedAt: Date | null;
  }[]>`
    select kid, public_jwk as "publicJwk", not_before as "notBefore", not_after as "notAfter", revoked_at as "revokedAt"
    from source_app_keys where source_app_id = ${source.id}
  `;
  return { ...source, keys };
}

export async function consumeVerifiedLaunch(
  sql: postgres.Sql,
  input: { accountId: string; sourceSlug: string; launch: VerifiedLaunchDraft; nonceSecret: string; correlationId?: string },
): Promise<string | null> {
  return sql.begin(async (tx) => {
    const [source] = await tx<{ id: string }[]>`
      select id from source_apps where slug = ${input.sourceSlug} and enabled and paused_at is null for share
    `;
    if (!source) return null;
    const nonceId = newId();
    const nonceHash = createHmac("sha256", input.nonceSecret).update(input.launch.nonce).digest();
    const inserted = await tx<{ id: string }[]>`
      insert into launch_nonces (id, source_app_id, nonce_hash, issued_at, expires_at, consumed_at)
      values (${nonceId}, ${source.id}, ${nonceHash}, ${input.launch.issuedAt}, ${input.launch.expiresAt}, now())
      on conflict (source_app_id, nonce_hash) do nothing returning id
    `;
    if (!inserted.length) return null;
    const sessionId = newId();
    await tx`
      insert into launch_sessions (
        id, source_app_id, account_id, environment, route, screen, app_version,
        source_revision, return_url, token_fingerprint, expires_at
      ) values (
        ${sessionId}, ${source.id}, ${input.accountId}, ${input.launch.environment}, ${input.launch.location},
        ${input.launch.screenName ?? input.launch.location}, ${input.launch.appVersion ?? "unknown"},
        ${input.launch.sourceRevision ?? "unknown"}, ${input.launch.returnUrl ?? ""},
        ${input.launch.tokenFingerprint}, now() + interval '30 minutes'
      )
    `;
    await tx`update launch_nonces set launch_session_id = ${sessionId} where id = ${nonceId}`;
    await appendAuditEventInTransaction(tx, {
      id: newId(),
      eventAt: new Date().toISOString(),
      actorType: "ACCOUNT",
      actorId: input.accountId,
      action: "launch.accepted",
      targetType: "launch_session",
      targetId: sessionId,
      result: "SUCCESS",
      correlationId: input.correlationId ?? newId(),
      safeMetadata: { sourceSlug: input.sourceSlug },
    });
    return sessionId;
  }) as Promise<string | null>;
}
