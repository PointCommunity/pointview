import { describe, expect, it, vi } from "vitest";

import type { GitHubAppClient } from "@/server/github/client";
import { GitHubMutationAdapter } from "@/server/github/mutation-port";

function projectEnvelope() {
  return {
    data: {
      node: {
        id: "PVT_expected",
        number: 4,
        public: false,
        fields: {
          pageInfo: { hasNextPage: false },
          nodes: [
            { id: "F_status", name: "Status", options: [{ id: "O_backlog", name: "Backlog" }] },
            { id: "F_priority", name: "Priority", options: [{ id: "O_p2", name: "P2" }] },
            { id: "F_impact", name: "Impact", options: [{ id: "O_medium", name: "Medium" }] },
            { id: "F_effort", name: "Effort", options: [{ id: "O_m", name: "M" }] },
          ],
        },
      },
    },
  };
}

describe("live GitHub mutation adapter contract", () => {
  it("reads the exact private Project schema and repository labels", async () => {
    const client = {
      repositoryPages: vi.fn(async () => [{ name: "type:feature" }, { name: "area:feedback" }]),
      graphqlJson: vi.fn(async () => projectEnvelope()),
    } as unknown as GitHubAppClient;
    const adapter = new GitHubMutationAdapter(client, "PointCommunity", "pointview", "PVT_expected", 4);
    await expect(adapter.readMutationPreconditions()).resolves.toEqual({
      nodeId: "PVT_expected",
      number: 4,
      public: false,
      repository: "PointCommunity/pointview",
      labels: ["type:feature", "area:feedback"],
      fields: { Status: ["Backlog"], Priority: ["P2"], Impact: ["Medium"], Effort: ["M"] },
    });
    expect(client.repositoryPages).toHaveBeenCalledWith("PointCommunity", "pointview", "labels?per_page=100");
  });

  it("sets only the four governed single-select fields", async () => {
    const mutations: Array<Record<string, unknown>> = [];
    const client = {
      graphqlJson: vi.fn(async (query: string, variables: Record<string, unknown>) => {
        if (query.startsWith("query")) return projectEnvelope();
        mutations.push(variables);
        return { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_1" } } } };
      }),
    } as unknown as GitHubAppClient;
    const adapter = new GitHubMutationAdapter(client, "PointCommunity", "pointview", "PVT_expected", 4);
    await adapter.setProjectFields("PVTI_1", { status: "Backlog", priority: "P2", impact: "Medium", effort: "M" });
    expect(mutations).toEqual([
      { project: "PVT_expected", item: "PVTI_1", field: "F_status", option: "O_backlog" },
      { project: "PVT_expected", item: "PVTI_1", field: "F_priority", option: "O_p2" },
      { project: "PVT_expected", item: "PVTI_1", field: "F_impact", option: "O_medium" },
      { project: "PVT_expected", item: "PVTI_1", field: "F_effort", option: "O_m" },
    ]);
  });
});
