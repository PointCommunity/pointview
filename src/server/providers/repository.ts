import { createHash } from "node:crypto";

import type postgres from "postgres";

import { appendAuditEventInTransaction } from "@/server/audit/repository";
import { newId } from "@/server/db/ids";
import type { RequestAccount } from "@/server/feedback/service";

import { decryptCredential, encryptCredential, providerName, type CredentialEnvelope, type ProviderName } from "./credentials";
import { providerCatalog, type ProviderConnectionSummary, type ProviderModel } from "./types";

export class ProviderConnectionError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) { super(message); this.name = "ProviderConnectionError"; }
}

function requireOwner(actor: RequestAccount): void {
  if (actor.status !== "ACTIVE" || actor.role !== "OWNER") throw new ProviderConnectionError("ACCESS_DENIED", "Only an Owner may manage model providers", 403);
}

type StoredConnection = {
  id: string;
  provider: ProviderName;
  status: ProviderConnectionSummary["status"];
  credentialEnvelope: CredentialEnvelope | null;
  credentialVersion: number;
  planType: string | null;
  modelCatalog: unknown;
  lastVerifiedAt: Date | string | null;
  failureCode: string | null;
  version: number;
};

function summary(row: StoredConnection): ProviderConnectionSummary {
  return {
    provider: row.provider,
    status: row.status,
    credentialConfigured: row.credentialEnvelope !== null,
    planType: row.planType,
    models: providerCatalog.parse(row.modelCatalog),
    lastVerifiedAt: row.lastVerifiedAt ? new Date(row.lastVerifiedAt).toISOString() : null,
    failureCode: row.failureCode,
    version: row.version,
  };
}

export async function listProviderConnections(sql: postgres.Sql, actor: RequestAccount): Promise<ProviderConnectionSummary[]> {
  requireOwner(actor);
  const rows = await sql<StoredConnection[]>`
    select id, provider, status, credential_envelope as "credentialEnvelope", credential_version as "credentialVersion",
      plan_type as "planType", model_catalog as "modelCatalog", last_verified_at as "lastVerifiedAt",
      failure_code as "failureCode", version
    from provider_connections order by provider
  `;
  const byProvider = new Map(rows.map((row) => [row.provider, summary(row)]));
  return providerName.options.map((provider) => byProvider.get(provider) ?? {
    provider,
    status: "DISCONNECTED",
    credentialConfigured: false,
    planType: null,
    models: [],
    lastVerifiedAt: null,
    failureCode: null,
    version: 0,
  });
}

export async function saveConnectedProvider(sql: postgres.Sql, options: {
  actor: RequestAccount;
  provider: ProviderName;
  credential: string;
  encryptionKey: Uint8Array;
  planType: string | null;
  models: ProviderModel[];
  correlationId: string;
  expectedVersion?: number;
}): Promise<ProviderConnectionSummary> {
  requireOwner(options.actor);
  if (!options.credential || Buffer.byteLength(options.credential, "utf8") > 1_000_000) {
    throw new ProviderConnectionError("PROVIDER_CREDENTIAL_INVALID", "The provider credential is invalid", 400);
  }
  const models = providerCatalog.parse(options.models);
  const catalogDigest = createHash("sha256").update(JSON.stringify(models)).digest("hex");
  const result = await sql.begin(async (tx) => {
    const [current] = await tx<StoredConnection[]>`
      select id, provider, status, credential_envelope as "credentialEnvelope", credential_version as "credentialVersion",
        plan_type as "planType", model_catalog as "modelCatalog", last_verified_at as "lastVerifiedAt",
        failure_code as "failureCode", version
      from provider_connections where provider = ${options.provider} for update
    `;
    if (options.expectedVersion !== undefined && (current?.version ?? 0) !== options.expectedVersion) {
      throw new ProviderConnectionError("PROVIDER_VERSION_CONFLICT", "Provider connection changed; refresh and try again", 412);
    }
    const id = current?.id ?? newId();
    const credentialVersion = (current?.credentialVersion ?? 0) + 1;
    const envelope = encryptCredential(options.credential, options.encryptionKey, { connectionId: id, provider: options.provider, credentialVersion });
    const [saved] = await tx<StoredConnection[]>`
      insert into provider_connections (
        id, provider, status, credential_envelope, credential_version, plan_type, model_catalog,
        catalog_digest, last_verified_at, failure_code, version
      ) values (
        ${id}, ${options.provider}, 'CONNECTED', ${tx.json(envelope)}, ${credentialVersion}, ${options.planType},
        ${tx.json(models)}, ${catalogDigest}, now(), null, 1
      )
      on conflict (provider) do update set
        status = 'CONNECTED', credential_envelope = excluded.credential_envelope,
        credential_version = excluded.credential_version, plan_type = excluded.plan_type,
        model_catalog = excluded.model_catalog, catalog_digest = excluded.catalog_digest,
        last_verified_at = now(), failure_code = null, version = provider_connections.version + 1, updated_at = now()
      returning id, provider, status, credential_envelope as "credentialEnvelope", credential_version as "credentialVersion",
        plan_type as "planType", model_catalog as "modelCatalog", last_verified_at as "lastVerifiedAt",
        failure_code as "failureCode", version
    `;
    const activeProfiles = await tx<{ id: string; modelIdentifier: string }[]>`
      select id, model_identifier as "modelIdentifier" from model_profiles
      where provider_connection_id = ${saved.id} and active for update
    `;
    const availableIds = new Set(models.map((model) => model.id));
    for (const profile of activeProfiles) {
      if (availableIds.has(profile.modelIdentifier)) continue;
      await tx`update application_settings set model_profile_id = null where model_profile_id = ${profile.id} and superseded_at is null`;
      await tx`update model_profiles set active = false, updated_at = now() where id = ${profile.id}`;
    }
    await appendAuditEventInTransaction(tx, {
      id: newId(), eventAt: new Date().toISOString(), actorType: "ACCOUNT", actorId: options.actor.accountId,
      action: "provider.connected", targetType: "provider_connection", targetId: options.provider, result: "SUCCESS",
      correlationId: options.correlationId,
      safeMetadata: { provider: options.provider, modelCount: models.length, credentialVersion, connectionVersion: saved.version },
    });
    return summary(saved);
  });
  return result;
}

export async function loadProviderCredential(sql: postgres.Sql, provider: ProviderName, encryptionKey: Uint8Array): Promise<string> {
  const [row] = await sql<Pick<StoredConnection, "id" | "provider" | "status" | "credentialEnvelope" | "credentialVersion">[]>`
    select id, provider, status, credential_envelope as "credentialEnvelope", credential_version as "credentialVersion"
    from provider_connections where provider = ${provider}
  `;
  if (!row || row.status !== "CONNECTED" || !row.credentialEnvelope) {
    throw new ProviderConnectionError("PROVIDER_NOT_CONNECTED", "The model provider is not connected", 503);
  }
  return decryptCredential(row.credentialEnvelope, encryptionKey, {
    connectionId: row.id,
    provider: row.provider,
    credentialVersion: row.credentialVersion,
  });
}

export async function refreshProviderCredential(sql: postgres.Sql, options: {
  provider: ProviderName;
  credential: string;
  encryptionKey: Uint8Array;
  correlationId: string;
}): Promise<void> {
  if (!options.credential || Buffer.byteLength(options.credential, "utf8") > 1_000_000) {
    throw new ProviderConnectionError("PROVIDER_CREDENTIAL_INVALID", "The provider credential is invalid", 400);
  }
  await sql.begin(async (tx) => {
    const [current] = await tx<Pick<StoredConnection, "id" | "provider" | "status" | "credentialVersion">[]>`
      select id, provider, status, credential_version as "credentialVersion"
      from provider_connections where provider = ${options.provider} for update
    `;
    if (!current || current.status !== "CONNECTED") {
      throw new ProviderConnectionError("PROVIDER_NOT_CONNECTED", "The model provider is not connected", 503);
    }
    const credentialVersion = current.credentialVersion + 1;
    const envelope = encryptCredential(options.credential, options.encryptionKey, {
      connectionId: current.id, provider: current.provider, credentialVersion,
    });
    await tx`
      update provider_connections set credential_envelope = ${tx.json(envelope)}, credential_version = ${credentialVersion},
        last_verified_at = now(), version = version + 1, updated_at = now()
      where id = ${current.id}
    `;
    await appendAuditEventInTransaction(tx, {
      id: newId(), eventAt: new Date().toISOString(), actorType: "JOB", actorId: null,
      action: "provider.credential_refreshed", targetType: "provider_connection", targetId: options.provider,
      result: "SUCCESS", correlationId: options.correlationId,
      safeMetadata: { provider: options.provider, credentialVersion },
    });
  });
}

export async function disconnectProvider(sql: postgres.Sql, options: {
  actor: RequestAccount;
  provider: ProviderName;
  expectedVersion: number;
  correlationId: string;
}): Promise<void> {
  requireOwner(options.actor);
  await sql.begin(async (tx) => {
    const [current] = await tx<{ id: string; version: number }[]>`
      select id, version from provider_connections where provider = ${options.provider} for update
    `;
    if (!current || current.version !== options.expectedVersion) {
      throw new ProviderConnectionError("PROVIDER_VERSION_CONFLICT", "Provider connection changed; refresh and try again", 412);
    }
    await tx`
      update provider_connections set status = 'DISCONNECTED', credential_envelope = null, plan_type = null,
        model_catalog = '[]'::jsonb, catalog_digest = null, last_verified_at = now(), failure_code = null,
        version = version + 1, updated_at = now()
      where id = ${current.id}
    `;
    await tx`update model_profiles set active = false, updated_at = now() where provider_connection_id = ${current.id} and active`;
    await tx`update application_settings set model_profile_id = null where model_profile_id in (select id from model_profiles where provider_connection_id = ${current.id}) and superseded_at is null`;
    await appendAuditEventInTransaction(tx, {
      id: newId(), eventAt: new Date().toISOString(), actorType: "ACCOUNT", actorId: options.actor.accountId,
      action: "provider.disconnected", targetType: "provider_connection", targetId: options.provider, result: "SUCCESS",
      correlationId: options.correlationId, safeMetadata: { provider: options.provider, connectionVersion: current.version + 1 },
    });
  });
}
