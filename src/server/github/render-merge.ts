import { escapeHtml, htmlList, verifiedPointViewUrl } from "./html";

type MergeComment = {
  operationId: string;
  feedbackCount: number;
  userEvidenceSummary: string;
  researchFindings: string[];
  scopeImpact: string;
  pointViewRecordUrl: string;
};

export function renderMergeComment(input: MergeComment): string {
  if (!Number.isInteger(input.feedbackCount) || input.feedbackCount < 1) throw new Error("Feedback count is invalid");
  const reports = `${input.feedbackCount} related feedback ${input.feedbackCount === 1 ? "report" : "reports"}`;
  return [
    `<!-- pointview-operation:${escapeHtml(input.operationId)} -->`,
    "<h3>PointView triage evidence</h3>",
    `<p><strong>${reports}</strong> were associated with this Issue.</p>`,
    `<p>${escapeHtml(input.userEvidenceSummary)}</p>`,
    "<h4>Research findings</h4>",
    htmlList(input.researchFindings),
    "<h4>Scope impact</h4>",
    `<p>${escapeHtml(input.scopeImpact)}</p>`,
    `<p><a href="${verifiedPointViewUrl(input.pointViewRecordUrl)}">Review protected evidence and lineage in PointView</a>.</p>`,
  ].join("\n");
}
