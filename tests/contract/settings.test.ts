import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readRuntimeProfile, readSettings, updateSettings } from "@/server/config/settings";
import { migrateDown, migrateUp } from "@/server/db/migrations";
import { saveConnectedProvider } from "@/server/providers/repository";

const databaseUrl = process.env.DATABASE_TEST_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("versioned application settings", () => {
  const sql = postgres(databaseUrl!, { max: 3 });
  const camelSql = postgres(databaseUrl!, { max: 3, transform: postgres.camel });
  const owner = { accountId: "018f4f6d-7c00-7000-8000-000000000090", role: "OWNER" as const, status: "ACTIVE" as const };
  const valid = {
    triagePaused: false,
    triagePauseReason: null,
    rawRetentionDays: 180,
    selectedModel: {
      provider: "OPENAI_CODEX",
      modelIdentifier: "configured-model",
      reasoningEffort: "medium",
    },
  };
  const encryptionKey = Buffer.alloc(32, 7);

  beforeAll(async () => {
    await migrateDown(sql); await migrateUp(sql);
    await sql`insert into accounts (id, access_subject_hash, email_normalized, display_name, role, status) values (${owner.accountId}, 'owner-hash', 'owner@example.com', 'Owner', 'OWNER', 'ACTIVE')`;
    await saveConnectedProvider(sql, {
      actor: owner, provider: "OPENAI_CODEX", credential: "{}", encryptionKey, planType: "ChatGPT",
      models: [{ id: "configured-model", displayName: "Configured model", reasoningEfforts: ["medium"], defaultReasoningEffort: "medium", inputModalities: ["text", "image"] }],
      correlationId: "018f4f6d-7c00-7000-8000-000000000089",
    });
  });
  afterAll(async () => { await migrateDown(sql); await Promise.all([sql.end(), camelSql.end()]); });

  it("versions settings without returning prompt, schema, or secret values", async () => {
    const initial = await readSettings(sql, owner);
    expect(initial.version).toBe(1);
    const updated = await updateSettings(sql, { actor: owner, expectedVersion: 1, correlationId: "018f4f6d-7c00-7000-8000-000000000091", input: valid });
    expect(updated).toMatchObject({ version: 2, rawRetentionDays: 180, model: { provider: "OPENAI_CODEX", modelIdentifier: "configured-model" } });
    expect(JSON.stringify(updated)).not.toMatch(/promptText|schemaDefinition|secretReference|modelProfileId/i);
    const runtime = await readRuntimeProfile(camelSql);
    const mergeFinding = (((runtime.schemaDefinition.properties as Record<string, unknown>).units as Record<string, unknown>).items as Record<string, unknown>);
    const mutation = (((mergeFinding.properties as Record<string, unknown>).mutation as Record<string, unknown>).anyOf as Array<Record<string, unknown>>)[0];
    const researchFinding = (((mutation.properties as Record<string, unknown>).research_findings as Record<string, unknown>).items as Record<string, unknown>);
    expect(Object.keys(researchFinding.properties as Record<string, unknown>)).toEqual(expect.arrayContaining(["evidence_ids", "source_urls"]));
    expect(researchFinding.required).toEqual(expect.arrayContaining(["evidence_ids", "source_urls"]));
    expect(researchFinding.properties).not.toHaveProperty("sourceUrls");
    await expect(updateSettings(sql, { actor: owner, expectedVersion: 1, correlationId: "018f4f6d-7c00-7000-8000-000000000092", input: valid })).rejects.toThrow(/version changed/i);
  });

  it("rejects retention below 180 days and non-Owner access", async () => {
    await expect(updateSettings(sql, { actor: owner, expectedVersion: 2, correlationId: "018f4f6d-7c00-7000-8000-000000000093", input: { ...valid, rawRetentionDays: 179 } })).rejects.toThrow(/>=180/i);
    await expect(updateSettings(sql, { actor: owner, expectedVersion: 2, correlationId: "018f4f6d-7c00-7000-8000-000000000094", input: {
      ...valid, selectedModel: { ...valid.selectedModel, reasoningEffort: "high" },
    } })).rejects.toThrow(/reasoning level/i);
    await expect(readSettings(sql, { ...owner, role: "ADMIN" })).rejects.toThrow(/Owner/i);
  });
});
