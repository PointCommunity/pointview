import type postgres from "postgres";

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
  const [migration] = await sql<{ digest: string }[]>`select digest from schema_migrations where version = '0001'`;
  checks.push(migration?.digest === "pointview-initial-v1" ? { name: "migrations", ok: true } : { name: "migrations", ok: false, code: "MIGRATION_MISMATCH" });
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
  const [settings] = await sql<{ schedule: string; modelProfileId: string | null }[]>`
    select observed_schedule as schedule, model_profile_id as "modelProfileId" from application_settings
    where superseded_at is null order by version desc limit 1
  `;
  checks.push(settings?.schedule && settings.modelProfileId ? { name: "schedule", ok: true } : { name: "schedule", ok: false, code: "SCHEDULE_OR_MODEL_UNREADY" });
  return { ready: checks.every((check) => check.ok), checks };
}
