import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

describe("Next.js server bundling", () => {
  it("keeps the Codex CLI external so its executable path resolves at runtime", () => {
    expect(nextConfig.serverExternalPackages).toContain("@openai/codex");
  });
});
