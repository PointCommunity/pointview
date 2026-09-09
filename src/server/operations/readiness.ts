import type postgres from "postgres";

import { providerCatalog } from "@/server/providers/types";

type Check = { name: "database" | "migrations" | "storage" | "source_registry" | "github" | "schedule"; ok: boolean; code?: string };
type Source = { id: string; owner: string; repo: string; projectNodeId: string; projectNumber: number; installationId: number };

export type ReadinessDependencies = {
  storage: { probe(): Promise<void> };
  github: (source: Source) => Promise<void>;
};

export async function checkReadiness(sql: postgres.Sql, dependencies: ReadinessDependencies): Promise<{ ready: boolean; checks: Check[] }> {
  const checks: Check[] = [];
  try {
    await sql`select 1`;
    checks.push({ name: "database", ok: true });
  } catch {
    return { ready: false, checks: [{ name: "database", ok: false, code: "DATABASE_UNAVAILABLE" }] };
  }
  const migrations = await sql<{ version: string; digest: string }[]>`select version, digest from schema_migrations where version in ('0001', '0002') order by version`;
  const migrationDigests = new Map(migrations.map((migration) => [migration.version, migration.digest]));
  checks.push(migrationDigests.get("0001") === "pointview-initial-v1" && migrationDigests.get("0002") === "pointview-provider-connections-v1"
    ? { name: "migrations", ok: true } : { name: "migrations", ok: false, code: "MIGRATION_MISMATCH" });
  try { await dependencies.storage.probe(); checks.push({ name: "storage", ok: true }); } catch { checks.push({ name: "storage", ok: false, code: "STORAGE_UNAVAILABLE" }); }
  const sources = await sql<Source[]>`
    select id, github_owner as owner, github_repo as repo, github_project_node_id as "projectNodeId", github_project_number as "projectNumber",
      github_installation_id::int as "installationId"
    from source_apps where enabled and paused_at is null and validation_status = 'VALID' order by id
  `;
  const [{ invalid }] = await sql<{ invalid: number }[]>`select count(*)::int as invalid from source_apps where enabled and (paused_at is not null or validation_status <> 'VALID')`;
  checks.push(sources.length > 0 && invalid === 0 ? { name: "source_registry", ok: true } : { name: "source_registry", ok: false, code: "SOURCE_REGISTRY_UNREADY" });
  let githubOk = sources.length > 0;
  for (const source of sources) {
    try { await dependencies.github(source); } catch { githubOk = false; }
  }
  checks.push(githubOk ? { name: "github", ok: true } : { name: "github", ok: false, code: "GITHUB_CONFIGURATION_UNREADY" });
  const [settings] = await sql<{ schedule: string; modelProfileId: string | null; providerStatus: string | null; modelIdentifier: string | null; modelCatalog: unknown }[]>`
    select s.observed_schedule as schedule, s.model_profile_id as "modelProfileId", pc.status as "providerStatus",
      mp.model_identifier as "modelIdentifier", pc.model_catalog as "modelCatalog"
    from application_settings s
    left join model_profiles mp on mp.id = s.model_profile_id and mp.active
    left join provider_connections pc on pc.id = mp.provider_connection_id
    where s.superseded_at is null order by s.version desc limit 1
  `;
  const modelAvailable = (() => {
    if (!settings?.modelIdentifier) return false;
    const catalog = providerCatalog.safeParse(settings.modelCatalog);
    return catalog.success && catalog.data.some((model) => model.id === settings.modelIdentifier);
  })();
  checks.push(settings?.schedule && settings.modelProfileId && settings.providerStatus === "CONNECTED" && modelAvailable
    ? { name: "schedule", ok: true } : { name: "schedule", ok: false, code: "SCHEDULE_OR_MODEL_UNREADY" });
  return { ready: checks.every((check) => check.ok), checks };
}
