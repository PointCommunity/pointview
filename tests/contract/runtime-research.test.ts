import { describe, expect, it, vi } from "vitest";

import { RuntimeResearchProvider } from "@/server/research/runtime";

const source = {
  id: "src_1",
  version: 3,
  owner: "PointCommunity",
  repo: "example",
  projectNodeId: "PVT_project",
  projectNumber: 7,
  installationId: 42,
  governedLabels: ["area:feedback", "priority:high"],
};

const record = {
  id: "fb_1",
  sourceAppId: source.id,
  sourceSlug: "example",
  sourceVersion: source.version,
  feedback: "The profile form needs clearer validation",
  environment: "canary",
  route: "/profile",
  screen: "Profile",
  appVersion: "1.2.3",
  sourceRevision: "abc123",
};

describe("runtime research", () => {
  it("captures all project statuses, excludes Done from candidates, and reuses a source snapshot", async () => {
    const graphqlJson = vi.fn().mockResolvedValue({
      data: {
        node: {
          id: source.projectNodeId,
          number: source.projectNumber,
          items: {
            nodes: [
              {
                id: "item_1",
                status: { name: "Backlog" },
                content: {
                  id: "issue_1", number: 11, title: "Improve profile validation", body: "Validation errors are unclear.",
                  repository: { nameWithOwner: "PointCommunity/example" },
                  labels: { nodes: [{ name: "area:feedback" }], pageInfo: { hasNextPage: false } },
                },
              },
              {
                id: "item_2",
                status: { name: "Done" },
                content: {
                  id: "issue_2", number: 4, title: "Old validation work", body: "Already shipped.",
                  repository: { nameWithOwner: "PointCommunity/example" },
                  labels: { nodes: [], pageInfo: { hasNextPage: false } },
                },
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    });
    const repositoryPages = vi.fn().mockResolvedValue([]);
    const withInstallationToken = vi.fn(async (operation: (token: string) => Promise<unknown>) => operation("ephemeral-token"));
    const collectRepository = vi.fn().mockResolvedValue({
      revision: "deadbeef",
      files: [{ path: "src/profile.ts", excerpt: "validate profile", digest: "digest" }],
      history: ["deadbeef\t2026-09-07T00:00:00Z\tProfile work"],
    });
    const fakeClient = { graphqlJson, repositoryPages, withInstallationToken };
    const provider = new RuntimeResearchProvider({} as never, {
      appId: 1,
      privateKeyPem: "unused",
      limits: { maxRankedIssues: 10, maxFactCharacters: 12_000, maxPacketBytes: 131_072, maxRepositoryFiles: 20 },
    }, {
      loadSource: async () => source,
      createClient: () => fakeClient as never,
      collectRepository,
      now: () => "2026-09-07T12:00:00.000Z",
    });

    const first = await provider.prepare(record);
    const second = await provider.prepare({ ...record, id: "fb_2" });

    expect(graphqlJson).toHaveBeenCalledTimes(1);
    expect(repositoryPages).toHaveBeenCalledTimes(1);
    expect(collectRepository).toHaveBeenCalledTimes(2);
    expect(collectRepository).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "ephemeral-token", maxFiles: 20 }));
    expect(first.eligibilityManifest.nonDoneIssues.map((issue) => issue.nodeId)).toEqual(["issue_1"]);
    expect(first.eligibilityManifest.doneHistoryIds).toEqual(["issue_2"]);
    expect(first.validationContext.eligibleIssues.has("issue_2")).toBe(false);
    expect(first.validationContext.allowedAreaLabels).toEqual(new Set(["area:feedback"]));
    expect(first.evidencePacket.evidence[0]?.facts.context).toMatchObject({ route: "/profile", sourceRevision: "abc123" });
    expect(second.eligibilityManifest.projectRevision).toBe(first.eligibilityManifest.projectRevision);
  });

  it("rejects project items from a repository outside the registered source", async () => {
    const fakeClient = {
      graphqlJson: vi.fn().mockResolvedValue({
        data: {
          node: {
            id: source.projectNodeId,
            number: source.projectNumber,
            items: {
              nodes: [{
                id: "item_bad", status: { name: "Backlog" },
                content: {
                  id: "issue_bad", number: 1, title: "Wrong repo", body: "",
                  repository: { nameWithOwner: "Other/private" },
                  labels: { nodes: [], pageInfo: { hasNextPage: false } },
                },
              }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      }),
      repositoryPages: vi.fn(),
      withInstallationToken: vi.fn(),
    };
    const provider = new RuntimeResearchProvider({} as never, {
      appId: 1,
      privateKeyPem: "unused",
      limits: { maxRankedIssues: 10, maxFactCharacters: 12_000, maxPacketBytes: 131_072, maxRepositoryFiles: 20 },
    }, { loadSource: async () => source, createClient: () => fakeClient as never });

    await expect(provider.prepare(record)).rejects.toThrow("unexpected repository");
  });
});
