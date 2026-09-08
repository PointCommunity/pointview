import { describe, expect, it } from "vitest";

import { reviewReasons } from "@/server/triage/risk-review";

describe("risk-based independent review", () => {
  it("reviews new, security, privacy, low-confidence, conflicting, active, and mixed decisions", () => {
    expect(reviewReasons({ disposition: "CREATED", kind: "FEATURE", confidence: 0.9, riskFlags: [] })).toContain("NEW_ISSUE");
    expect(reviewReasons({ disposition: "MERGED", kind: "SECURITY", confidence: 0.9, riskFlags: [] })).toContain("SECURITY");
    expect(reviewReasons({ disposition: "CONSIDERED", kind: "OTHER", confidence: 0.4, riskFlags: [] })).toContain("LOW_CONFIDENCE");
    expect(reviewReasons({ disposition: "MERGED", kind: "BUG", confidence: 0.9, riskFlags: ["PRIVACY", "MULTIPLE_MATCHES", "ACTIVE_ISSUE_MATCH", "MIXED_FEEDBACK"] })).toEqual(
      expect.arrayContaining(["PRIVACY", "MULTIPLE_MATCHES", "ACTIVE_ISSUE_MATCH", "MIXED_FEEDBACK"]),
    );
  });

  it("does not spend a second call on a high-confidence ordinary merge", () => {
    expect(reviewReasons({ disposition: "MERGED", kind: "BUG", confidence: 0.91, riskFlags: [] })).toEqual([]);
  });
});
