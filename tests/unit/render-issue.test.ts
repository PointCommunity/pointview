import { describe, expect, it } from "vitest";

import { renderCreatedIssue } from "@/server/github/render-issue";
import { renderMergeComment } from "@/server/github/render-merge";

describe("GitHub HTML renderers", () => {
  it("escapes untrusted created-Issue content and includes governed sections and marker", () => {
    const body = renderCreatedIssue({
      operationId: "018f4f6d-7c00-7000-8000-000000000001",
      summary: "Support <script>alert(1)</script> safely.",
      userEvidence: ["A user requested safer feedback."],
      researchFindings: ["Current code has no matching behavior."],
      scope: ["Add the behavior."],
      acceptanceCriteria: ["The behavior is verified."],
      verification: ["Run the contract tests."],
      outOfScope: ["Automatic implementation."],
      pointViewRecordUrl: "https://view.pointatx.org/feedback/018f4f6d-7c00-7000-8000-000000000002",
    });
    expect(body).toContain("<!-- pointview-operation:018f4f6d-7c00-7000-8000-000000000001 -->");
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(body).not.toContain("<script>");
    for (const section of ["Summary", "User evidence", "Research", "Scope", "Acceptance criteria", "Verification", "Out of scope"]) {
      expect(body).toContain(`<h2>${section}</h2>`);
    }
  });

  it("renders one privacy-minimized merge comment", () => {
    const body = renderMergeComment({
      operationId: "018f4f6d-7c00-7000-8000-000000000003",
      feedbackCount: 3,
      userEvidenceSummary: "Multiple users encountered the same failure.",
      researchFindings: ["The current acceptance criteria omit recovery."],
      scopeImpact: "Add a recovery-path criterion.",
      pointViewRecordUrl: "https://view.pointatx.org/feedback/018f4f6d-7c00-7000-8000-000000000004",
    });
    expect(body).toContain("3 related feedback reports");
    expect(body).not.toMatch(/@[A-Za-z0-9]|mailto:/);
  });
});
