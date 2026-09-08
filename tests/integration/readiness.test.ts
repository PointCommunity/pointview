import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { newId } from "@/server/db/ids";
import { migrateDown, migrateUp } from "@/server/db/migrations";
import { checkReadiness } from "@/server/operations/readiness";

const databaseUrl = process.env.DATABASE_TEST_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("aggregate readiness", () => {
  const sql = postgres(databaseUrl!, { max: 3 });
  beforeAll(async () => { await migrateDown(sql); await migrateUp(sql); });
  afterAll(async () => { await migrateDown(sql); await sql.end(); });

  it("reports storage, registry, GitHub, and model/schedule dependencies without model work", async () => {
    const github = vi.fn(async () => undefined);
    const unready = await checkReadiness(sql, { storage: { probe: async () => { throw new Error("unavailable"); } }, github });
    expect(unready.ready).toBe(false);
    expect(unready.checks).toEqual(expect.arrayContaining([
      { name: "storage", ok: false, code: "STORAGE_UNAVAILABLE" },
      { name: "source_registry", ok: false, code: "SOURCE_REGISTRY_UNREADY" },
    ]));
    expect(github).not.toHaveBeenCalled();

    const model = newId();
    await sql`insert into model_profiles (id, provider, model_identifier, reasoning_effort, max_input_tokens, max_output_tokens, timeout_ms, active, secret_reference, prompt_version, prompt_digest, schema_version, schema_digest)
      values (${model}, 'OPENAI', 'fixture', 'medium', 1000, 1000, 1000, true, 'op://pointview/openai', 'prompt-v1', ${"a".repeat(64)}, '1.1.0', ${"b".repeat(64)})`;
    await sql`update application_settings set model_profile_id = ${model} where superseded_at is null`;
    await sql`insert into source_apps (id, slug, display_name, enabled, github_owner, github_repo, github_project_node_id, github_project_number, github_installation_id, allowed_origins, return_url_prefixes, validation_status)
      values (${newId()}, 'ready', 'Ready', true, 'PointCommunity', 'pointview', 'PVT_expected', 4, 10, array['https://pointview.test'], array['https://pointview.test/'], 'VALID')`;
    const ready = await checkReadiness(sql, { storage: { probe: async () => undefined }, github });
    expect(ready.ready).toBe(true);
    expect(github).toHaveBeenCalledOnce();
    github.mockRejectedValueOnce(new Error("GitHub unavailable"));
    const failed = await checkReadiness(sql, { storage: { probe: async () => undefined }, github });
    expect(failed.checks).toContainEqual({ name: "github", ok: false, code: "GITHUB_CONFIGURATION_UNREADY" });
  });
});
