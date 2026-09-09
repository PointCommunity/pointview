import { access, readFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { SdkCodexRuntime } from "@/server/providers/codex/runtime";

describe("SdkCodexRuntime", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses an empty temporary home and removes it after the run", async () => {
    let observedHome = "";
    let observedAuth = "";
    const run = vi.fn(async () => ({ finalResponse: "{}", usage: null, items: [] }));
    const startThread = vi.fn((options) => ({ run: async () => {
      observedHome = options.workingDirectory;
      observedAuth = await readFile(`${options.workingDirectory}/../codex/auth.json`, "utf8");
      return run();
    } }));
    const runtime = new SdkCodexRuntime((options) => {
      if (!options) throw new Error("Codex options are required");
      expect(options.env?.CODEX_HOME).toMatch(/\/codex$/);
      expect(options.env).not.toHaveProperty("DATABASE_URL");
      expect(options.config).toMatchObject({ features: { shell_tool: false, skill_search: false, skip_host_skill_discovery: true }, mcp_servers: {} });
      return { startThread };
    });

    await runtime.run({
      credential: "{\"auth_mode\":\"chatgpt\"}", model: "gpt-test", reasoningEffort: "high", timeoutMs: 1000,
      systemPolicy: "policy", evidencePacket: { evidence: [] }, outputSchema: {},
      isolation: { sandboxMode: "read-only", approvalPolicy: "never", networkAccessEnabled: false, webSearchMode: "live", ephemeral: true, loadUserConfig: false, loadProjectRules: false },
    });

    expect(observedAuth).toBe("{\"auth_mode\":\"chatgpt\"}");
    expect(startThread).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-test", sandboxMode: "read-only", approvalPolicy: "never", networkAccessEnabled: false,
      webSearchMode: "live", skipGitRepoCheck: true,
    }));
    await expect(access(observedHome)).rejects.toThrow();
  });
});
