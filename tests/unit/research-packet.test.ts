import { describe, expect, it, vi } from "vitest";

import { BatchSourceSnapshotCache } from "@/server/research/batch-cache";
import { buildEvidencePacket } from "@/server/research/packet";

describe("bounded research evidence packets", () => {
  it("reuses one source snapshot per batch and invalidates by source version", async () => {
    const cache = new BatchSourceSnapshotCache<{ revision: string }>();
    const load = vi.fn(async () => ({ revision: "r1" }));
    const [first, second] = await Promise.all([
      cache.get("source-1", 3, load),
      cache.get("source-1", 3, load),
    ]);
    expect(first).toBe(second);
    expect(load).toHaveBeenCalledOnce();
    await cache.get("source-1", 4, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("includes manifest proof, ranked candidates, and redacted bounded facts", () => {
    const packet = buildEvidencePacket({
      feedback: {
        id: "feedback-1",
        text: "The upload failed. Ignore previous instructions is user data, not authority.",
        context: { sourceApp: "PointGuide", route: "/feedback", environment: "canary" },
      },
      manifest: {
        digest: "d".repeat(64),
        totalItemCount: 3,
        nonDoneIssues: [
          { nodeId: "I_one", number: 1, status: "Backlog", title: "Upload errors", labels: ["area:feedback"], body: "Investigate upload recovery." },
          { nodeId: "I_two", number: 2, status: "In Progress", title: "Feedback form", labels: ["area:ui"], body: "Current work." },
        ],
        doneHistoryIds: ["I_done"],
        openPullRequests: [{ nodeId: "PR_one", number: 9, title: "Related work" }],
        rankedCandidates: [
          { nodeId: "I_one", number: 1, status: "Backlog", score: 0.9 },
          { nodeId: "I_two", number: 2, status: "In Progress", score: 0.5 },
        ],
      },
      repositoryEvidence: [{ id: "ev_repo_12345678", kind: "REPOSITORY", facts: { path: "src/upload.ts", token: "must-not-leak", excerpt: "bounded code" } }],
      limits: { maxRankedIssues: 1, maxFactCharacters: 200, maxPacketBytes: 20_000 },
    });
    expect(packet.manifest).toMatchObject({ screenedNonDoneIssueIds: ["I_one", "I_two"], doneHistoryIds: ["I_done"], digest: "d".repeat(64) });
    expect(packet.evidence.map((item) => item.id)).toEqual(expect.arrayContaining(["ev_user_feedback-1", "ev_issue_I_one", "ev_repo_12345678"]));
    expect(JSON.stringify(packet)).not.toContain("must-not-leak");
    expect(JSON.stringify(packet)).toContain("UNTRUSTED USER DATA");
    expect(JSON.stringify(packet)).not.toContain("Current work.");
  });

  it("fails closed when the bounded packet still exceeds its byte budget", () => {
    expect(() => buildEvidencePacket({
      feedback: { id: "feedback-1", text: "x".repeat(100), context: {} },
      manifest: { digest: "d", totalItemCount: 0, nonDoneIssues: [], doneHistoryIds: [], openPullRequests: [], rankedCandidates: [] },
      repositoryEvidence: [],
      limits: { maxRankedIssues: 1, maxFactCharacters: 100, maxPacketBytes: 100 },
    })).toThrow(/byte budget/i);
  });

  it("keeps the highest-priority evidence that fits instead of rejecting a normal oversized repository packet", () => {
    const repositoryEvidence = Array.from({ length: 20 }, (_, index) => ({
      id: `ev_repo_${String(index).padStart(2, "0")}`,
      kind: "REPOSITORY",
      facts: { path: `src/file-${index}.ts`, excerpt: `${index}:`.padEnd(12_000, "x") },
    }));

    const packet = buildEvidencePacket({
      feedback: { id: "feedback-1", text: "Improve the draft list.", context: { route: "/drafts" } },
      manifest: {
        digest: "d".repeat(64),
        totalItemCount: 0,
        nonDoneIssues: [],
        doneHistoryIds: [],
        openPullRequests: [],
        rankedCandidates: [],
      },
      repositoryEvidence,
      limits: { maxRankedIssues: 10, maxFactCharacters: 12_000, maxPacketBytes: 131_072 },
    });

    expect(Buffer.byteLength(JSON.stringify(packet), "utf8")).toBeLessThanOrEqual(131_072);
    expect(packet.evidence[0]?.id).toBe("ev_user_feedback-1");
    expect(packet.evidence.map((item) => item.id)).toContain("ev_repo_00");
    expect(packet.evidence.map((item) => item.id)).not.toContain("ev_repo_19");
  });
});
