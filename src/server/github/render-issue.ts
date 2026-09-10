import { escapeHtml, htmlList, verifiedPointViewUrl } from "./html";

type CreatedIssue = {
  operationId: string;
  summary: string;
  userEvidence: string[];
  researchFindings: string[];
  scope: string[];
  acceptanceCriteria: string[];
  verification: string[];
  outOfScope: string[];
  pointViewRecordUrl: string;
};

export function renderCreatedIssue(input: CreatedIssue): string {
  const source = verifiedPointViewUrl(input.pointViewRecordUrl);
  return [
    `<!-- pointview-operation:${escapeHtml(input.operationId)} -->`,
    "<h2>Summary</h2>",
    `<p>${escapeHtml(input.summary)}</p>`,
    "<h2>User evidence</h2>",
    htmlList(input.userEvidence),
    "<h2>Research</h2>",
    htmlList(input.researchFindings),
    "<h2>Scope</h2>",
    htmlList(input.scope),
    "<h2>Acceptance criteria</h2>",
    htmlList(input.acceptanceCriteria),
    "<h2>Verification</h2>",
    htmlList(input.verification),
    "<h2>Out of scope</h2>",
    htmlList(input.outOfScope),
    `<p>Protected PointView record: <a href="${source}">review evidence and lineage</a>.</p>`,
  ].join("\n");
}

