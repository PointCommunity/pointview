import { describe, expect, it } from "vitest";

import { collectProjectIssues } from "@/server/github/project-reader";

describe("Project reader", () => {
  it("paginates every Issue and classifies current Status", async () => {
    const cursors: Array<string | null> = [];
    const pages = [
      {
        project: { nodeId: "PVT_expected", number: 2 },
        items: [
          { id: "item-1", content: { type: "Issue" as const, nodeId: "I_1", number: 1, title: "One", body: "First", repository: "PointCommunity/app" }, status: "Backlog", labels: ["area:ui"] },
        ],
        pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
      },
      {
        project: { nodeId: "PVT_expected", number: 2 },
        items: [
          { id: "item-2", content: { type: "Issue" as const, nodeId: "I_2", number: 2, title: "Two", body: "Second", repository: "PointCommunity/app" }, status: "Done", labels: ["area:data"] },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    ];
    const result = await collectProjectIssues({ projectNodeId: "PVT_expected", projectNumber: 2 }, async (cursor) => {
      cursors.push(cursor);
      return pages[cursors.length - 1];
    });
    expect(cursors).toEqual([null, "cursor-1"]);
    expect(result.issues.map((issue) => [issue.nodeId, issue.status])).toEqual([["I_1", "Backlog"], ["I_2", "Done"]]);
    expect(result.revision).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails closed on redacted content, missing Status, or Project drift", async () => {
    const base = { project: { nodeId: "PVT_expected", number: 2 }, pageInfo: { hasNextPage: false, endCursor: null } };
    await expect(collectProjectIssues({ projectNodeId: "PVT_expected", projectNumber: 2 }, async () => ({ ...base, items: [{ id: "redacted", content: null, status: "Backlog", labels: [] }] }))).rejects.toThrow(/redacted/i);
    await expect(collectProjectIssues({ projectNodeId: "PVT_expected", projectNumber: 2 }, async () => ({ ...base, items: [{ id: "missing", content: { type: "Issue" as const, nodeId: "I", number: 1, title: "x", body: "x", repository: "PointCommunity/app" }, status: null, labels: [] }] }))).rejects.toThrow(/Status/i);
    await expect(collectProjectIssues({ projectNodeId: "PVT_expected", projectNumber: 2 }, async () => ({ ...base, project: { nodeId: "PVT_other", number: 2 }, items: [] }))).rejects.toThrow(/identity/i);
  });
});
