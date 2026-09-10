import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/helpers/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "packages/launch-sdk/src/**/*.ts",
        "src/server/audit/{chain,logger}.ts",
        "src/server/auth/{csrf,session}.ts",
        "src/server/feedback/images.ts",
        "src/server/github/{apply-decision,html,preconditions,project-reader,render-issue,render-merge}.ts",
        "src/server/http/{problem,rate-limit}.ts",
        "src/server/launch/{cookie,verify}.ts",
        "src/server/providers/{credentials,http,ollama,types}.ts",
        "src/server/providers/codex/{protocol,runtime}.ts",
        "src/server/research/{batch-cache,manifest,packet,repository,runtime}.ts",
        "src/server/source-apps/{github-validation,validation}.ts",
        "src/server/triage/{batch,decision-validator,orchestrator}.ts",
        "src/server/triage/model/{codex,ollama,web-sources}.ts",
      ],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 75 },
    },
  },
});
