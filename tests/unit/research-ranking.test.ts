import { describe, expect, it } from "vitest";

import { buildEligibilityManifest, rankIssueCandidates } from "@/server/research/manifest";

const issues = [
  { nodeId: "I_one", number: 1, title: "Add screenshot feedback", body: "Allow users to attach feedback screenshots", status: "Backlog", labels: ["area:feedback"] },
  { nodeId: "I_two", number: 2, title: "Improve login", body: "Cloudflare Access account handling", status: "Done", labels: ["area:identity"] },
  { nodeId: "I_three", number: 3, title: "Feedback upload errors", body: "Show errors when screenshot upload fails", status: "In Progress", labels: ["area:feedback", "area:ui"] },
];

describe("research manifests", () => {
  it("screens every Project Issue and excludes Done only from target eligibility", () => {
    const manifest = buildEligibilityManifest({
      projectRevision: "project-v1",
      issues,
      openPullRequests: [{ nodeId: "PR_one", number: 4, title: "Current work" }],
      retrievalPolicyVersion: "1.0.0",
      query: "screenshot upload feedback errors",
      capturedAt: "2026-09-07T12:00:00.000Z",
    });
    expect(manifest.totalItemCount).toBe(3);
    expect(manifest.nonDoneIssues.map((issue) => issue.nodeId)).toEqual(["I_one", "I_three"]);
    expect(manifest.doneHistoryIds).toEqual(["I_two"]);
    expect(manifest.rankedCandidates[0].nodeId).toBe("I_three");
    expect(manifest.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic and favors exact title overlap", () => {
    const ranked = rankIssueCandidates("add screenshot feedback", issues.filter((issue) => issue.status !== "Done"));
    expect(ranked[0].nodeId).toBe("I_one");
    expect(ranked.every((item) => Number.isFinite(item.score))).toBe(true);
  });
});
