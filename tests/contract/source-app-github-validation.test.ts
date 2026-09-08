import { describe, expect, it } from "vitest";

import type { GitHubAppClient } from "@/server/github/client";
import { validateGitHubSourceTarget } from "@/server/source-apps/github-validation";

const input = {
  slug: "pointguide",
  displayName: "PointGuide",
  githubOwner: "PointCommunity",
  githubRepo: "pointguide",
  githubProjectNodeId: "PVT_pointguide",
  githubProjectNumber: 2,
  githubInstallationId: 42,
  allowedOrigins: ["https://guide.pointatx.org"],
  returnUrlPrefixes: ["https://guide.pointatx.org/"],
  governedLabels: ["type:bug", "type:feature", "type:maintenance", "type:security", "area:ui"],
  publicKeys: [{
    kid: "key-1",
    jwk: { kty: "OKP", crv: "Ed25519", x: "x".repeat(43) },
    notBefore: "2026-01-01T00:00:00.000Z",
    notAfter: "2027-01-01T00:00:00.000Z",
  }],
};

function client(projectId = "PVT_pointguide", extraFields: unknown[] = []) {
  return {
    repositoryJson: async () => ({ name: "pointguide", private: true, owner: { login: "PointCommunity" } }),
    repositoryInstallationId: async () => 42,
    repositoryPages: async () => input.governedLabels.map((name) => ({ name })),
    projectReadback: async () => ({
      data: {
        node: {
          id: projectId,
          number: 2,
          public: false,
          fields: {
            pageInfo: { hasNextPage: false },
            nodes: [
              ...extraFields,
              { name: "Status", options: ["Backlog", "On Hold", "In Progress", "In Review", "Done"].map((name) => ({ name })) },
              { name: "Priority", options: ["P0", "P1", "P2", "P3"].map((name) => ({ name })) },
              { name: "Impact", options: ["High", "Medium", "Low"].map((name) => ({ name })) },
              { name: "Effort", options: ["XS", "S", "M", "L", "XL"].map((name) => ({ name })) },
            ],
          },
        },
      },
    }),
  } as unknown as GitHubAppClient;
}

describe("live GitHub source target validation", () => {
  it("produces a digest only after exact repository, installation, Project, field, and label readback", async () => {
    await expect(validateGitHubSourceTarget(client(), input)).resolves.toEqual({
      valid: true,
      errors: [],
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("fails closed without a digest on identity drift", async () => {
    const result = await validateGitHubSourceTarget(client("PVT_wrong"), input);
    expect(result.valid).toBe(false);
    expect(result.digest).toBeUndefined();
    expect(result.errors).toContain("Project identity does not match registration");
  });

  it("ignores non-single-select Project fields returned as empty union nodes", async () => {
    await expect(validateGitHubSourceTarget(client("PVT_pointguide", [{}, null]), input)).resolves.toEqual({
      valid: true,
      errors: [],
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });
});
