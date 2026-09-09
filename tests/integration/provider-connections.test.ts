import { randomBytes } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDown, migrateUp } from "@/server/db/migrations";
import {
  disconnectProvider,
  listProviderConnections,
  loadProviderCredential,
  saveConnectedProvider,
} from "@/server/providers/repository";

const databaseUrl = process.env.DATABASE_TEST_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("provider connections", () => {
  const sql = postgres(databaseUrl!, { max: 2 });
  const key = randomBytes(32);
  const owner = { accountId: "018f4f6d-7c00-7000-8000-000000000601", role: "OWNER" as const, status: "ACTIVE" as const };
  const admin = { ...owner, accountId: "018f4f6d-7c00-7000-8000-000000000602", role: "ADMIN" as const };

  beforeAll(async () => { await migrateDown(sql); await migrateUp(sql); });
  afterAll(async () => { await migrateDown(sql); await sql.end(); });

  it("stores an encrypted credential and returns only safe connection state", async () => {
    await saveConnectedProvider(sql, {
      actor: owner,
      provider: "OLLAMA_CLOUD",
      credential: JSON.stringify({ apiKey: "ollama-secret" }),
      encryptionKey: key,
      planType: null,
      models: [{ id: "gpt-oss:120b", displayName: "gpt-oss:120b", reasoningEfforts: [], defaultReasoningEffort: null, inputModalities: ["text"] }],
      correlationId: "018f4f6d-7c00-7000-8000-000000000603",
    });

    const connections = await listProviderConnections(sql, owner);
    expect(connections).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "OLLAMA_CLOUD", status: "CONNECTED", credentialConfigured: true, models: [expect.objectContaining({ id: "gpt-oss:120b" })] }),
    ]));
    expect(JSON.stringify(connections)).not.toContain("ollama-secret");

    const [stored] = await sql<{ envelope: unknown }[]>`select credential_envelope as envelope from provider_connections where provider = 'OLLAMA_CLOUD'`;
    expect(JSON.stringify(stored.envelope)).not.toContain("ollama-secret");
    await expect(loadProviderCredential(sql, "OLLAMA_CLOUD", key)).resolves.toBe(JSON.stringify({ apiKey: "ollama-secret" }));
  });

  it("rejects non-Owner access and clears credentials on disconnect", async () => {
    await expect(listProviderConnections(sql, admin)).rejects.toThrow(/Owner/i);
    const [{ id: providerId }] = await sql<{ id: string }[]>`select id from provider_connections where provider = 'OLLAMA_CLOUD'`;
    const profileId = "018f4f6d-7c00-7000-8000-000000000605";
    await sql`insert into model_profiles (id, provider, model_identifier, reasoning_effort, max_input_tokens, max_output_tokens, timeout_ms, active, provider_connection_id, secret_reference, prompt_version, prompt_digest, prompt_text, schema_version, schema_digest, schema_definition)
      values (${profileId}, 'OLLAMA_CLOUD', 'gpt-oss:120b', 'none', 1000, 1000, 1000, true, ${providerId}, 'provider://OLLAMA_CLOUD', 'prompt-v1', ${"a".repeat(64)}, 'policy', '1.1.0', ${"b".repeat(64)}, '{}'::jsonb)`;
    await sql`update application_settings set model_profile_id = ${profileId} where superseded_at is null`;
    await saveConnectedProvider(sql, {
      actor: owner, provider: "OLLAMA_CLOUD", credential: "replacement", encryptionKey: key, planType: null,
      models: [{ id: "replacement-model", displayName: "Replacement", reasoningEfforts: [], defaultReasoningEffort: null, inputModalities: ["text"] }],
      expectedVersion: 1, correlationId: "018f4f6d-7c00-7000-8000-000000000606",
    });
    const [stale] = await sql<{ active: boolean; selected: string | null }[]>`select mp.active, s.model_profile_id as selected from model_profiles mp cross join application_settings s where mp.id = ${profileId} and s.superseded_at is null`;
    expect(stale).toEqual({ active: false, selected: null });
    await disconnectProvider(sql, {
      actor: owner,
      provider: "OLLAMA_CLOUD",
      expectedVersion: 2,
      correlationId: "018f4f6d-7c00-7000-8000-000000000604",
    });
    const connection = (await listProviderConnections(sql, owner)).find((item) => item.provider === "OLLAMA_CLOUD");
    expect(connection).toMatchObject({ status: "DISCONNECTED", credentialConfigured: false, models: [], version: 3 });
    await expect(loadProviderCredential(sql, "OLLAMA_CLOUD", key)).rejects.toThrow(/not connected/i);
  });
});
