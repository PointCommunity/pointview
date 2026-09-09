import { describe, expect, it, vi } from "vitest";

import { finishCodexAuthorization } from "@/server/providers/codex/authorization";
import { discoverCodexModels, startCodexDeviceLogin, type CodexRpc } from "@/server/providers/codex/protocol";
import { providerModel } from "@/server/providers/types";
import { CodexDecisionModel, type CodexRuntime } from "@/server/triage/model/codex";

describe("Codex provider protocol", () => {
  it("uses the official device-code login shape without exposing tokens", async () => {
    const request = vi.fn(async () => ({
      type: "chatgptDeviceCode",
      loginId: "018f4f6d-7c00-7000-8000-000000000701",
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-1234",
    }));
    const result = await startCodexDeviceLogin({ request } as CodexRpc);
    expect(request).toHaveBeenCalledWith("account/login/start", { type: "chatgptDeviceCode" });
    expect(result).toEqual({ loginId: expect.any(String), verificationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-1234" });
    expect(JSON.stringify(result)).not.toMatch(/access.?token|refresh.?token/i);
  });

  it("maps picker-visible models, reasoning choices, and modalities", async () => {
    const rpc = { request: vi.fn(async () => ({ data: [
      { id: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", hidden: false, defaultReasoningEffort: "low", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }], inputModalities: ["text", "image"] },
      { id: "hidden", displayName: "Hidden", hidden: true, supportedReasoningEfforts: [], inputModalities: ["text"] },
    ], nextCursor: null })) } as CodexRpc;
    await expect(discoverCodexModels(rpc)).resolves.toEqual([
      { id: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", reasoningEfforts: ["low", "high"], defaultReasoningEffort: "low", inputModalities: ["text", "image"] },
    ]);
  });

  it("rejects repeated model-catalog cursors", async () => {
    const rpc = { request: vi.fn(async () => ({ data: [], nextCursor: "repeat" })) } as CodexRpc;
    await expect(discoverCodexModels(rpc)).rejects.toThrow(/repeated model cursor/i);
    expect(rpc.request).toHaveBeenCalledTimes(2);
  });

  it("fails a device-code session closed after a process restart", async () => {
    const sqlMustNotRun = new Proxy({}, {
      get() { throw new Error("The database must not be used for an unknown authorization session"); },
    });

    await expect(finishCodexAuthorization(sqlMustNotRun as never, {
      actor: { accountId: "018f4f6d-7c00-7000-8000-000000000702", role: "OWNER", status: "ACTIVE" },
      sessionId: "018f4f6d-7c00-7000-8000-000000000703",
      encryptionKey: new Uint8Array(32),
      correlationId: "018f4f6d-7c00-7000-8000-000000000704",
    })).resolves.toEqual({ state: "EXPIRED" });
  });

  it("rejects unusable model capabilities before they enter a catalog", () => {
    expect(() => providerModel.parse({
      id: "model", displayName: "Model", reasoningEfforts: ["low"],
      defaultReasoningEffort: "high", inputModalities: ["image"],
    })).toThrow();
  });
});

describe("Codex decision adapter", () => {
  it("enforces an isolated ephemeral runtime and parses schema output", async () => {
    const fixture = { schema_version: "1.1.0", record_summary: "Considered", units: [] };
    const run = vi.fn(async () => ({
      finalResponse: JSON.stringify(fixture),
      usage: { input_tokens: 100, output_tokens: 25 },
      items: [{ type: "web_search" as const, query: "official product documentation" }],
      refreshedCredential: "{\"tokens\":\"refreshed\"}",
    }));
    const runtime: CodexRuntime = { run };
    const onCredentialRefreshed = vi.fn(async () => undefined);
    const model = new CodexDecisionModel(runtime, {
      credential: "{\"tokens\":\"initial\"}",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      timeoutMs: 60_000,
      schema: { type: "object" },
      supportsImages: true,
      onCredentialRefreshed,
    });
    const result = await model.decide({ systemPolicy: "policy", evidencePacket: { evidence: [] } });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      credential: "{\"tokens\":\"initial\"}",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      systemPolicy: "policy",
      outputSchema: { type: "object" },
      isolation: {
        sandboxMode: "read-only",
        approvalPolicy: "never",
        networkAccessEnabled: false,
        webSearchMode: "live",
        ephemeral: true,
        loadUserConfig: false,
        loadProjectRules: false,
      },
    }));
    expect(result).toMatchObject({ decision: fixture, usage: { inputTokens: 100, outputTokens: 25, totalTokens: 125 } });
    expect(onCredentialRefreshed).toHaveBeenCalledWith("{\"tokens\":\"refreshed\"}");
  });

  it("fails closed if Codex attempts shell, file mutation, or MCP work", async () => {
    const runtime: CodexRuntime = { run: async () => ({
      finalResponse: "{}",
      usage: null,
      items: [{ type: "command_execution", command: "pwd" }],
      refreshedCredential: null,
    }) };
    const model = new CodexDecisionModel(runtime, {
      credential: "{}", model: "model", reasoningEffort: "low", timeoutMs: 1000, schema: {}, supportsImages: false, onCredentialRefreshed: async () => undefined,
    });
    await expect(model.decide({ systemPolicy: "policy", evidencePacket: { evidence: [] } })).rejects.toThrow(/forbidden tool/i);
  });

  it("returns only normalized HTTPS sources cited in the structured decision", async () => {
    const runtime: CodexRuntime = { run: async () => ({
      finalResponse: JSON.stringify({ units: [{ mutation: { research_findings: [{ source_urls: ["https://docs.example.com/guide#section", "http://localhost/private"] }] } }] }),
      usage: null, items: [{ type: "web_search", query: "topic" }], refreshedCredential: null,
    }) };
    const model = new CodexDecisionModel(runtime, {
      credential: "{}", model: "model", reasoningEffort: "low", timeoutMs: 1000, schema: {}, supportsImages: false, onCredentialRefreshed: async () => undefined,
    });
    await expect(model.decide({ systemPolicy: "policy", evidencePacket: { evidence: [] } })).resolves.toMatchObject({
      webSources: [{ id: expect.stringMatching(/^ev_web_/), url: "https://docs.example.com/guide", title: "docs.example.com" }],
    });
  });
});
