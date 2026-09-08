import { createHash } from "node:crypto";

export type ProjectIssue = {
  nodeId: string;
  number: number;
  title: string;
  body: string;
  status: string;
  labels: string[];
};

type PullRequest = { nodeId: string; number: number; title: string };

function tokens(value: string): Set<string> {
  return new Set(
    value
      .normalize("NFKC")
      .toLowerCase()
      .match(/[a-z0-9]{2,}/g) ?? [],
  );
}

function overlap(left: Set<string>, right: Set<string>): number {
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

export function rankIssueCandidates(query: string, issues: readonly ProjectIssue[]) {
  const queryTokens = tokens(query);
  const normalizedQuery = query.trim().toLowerCase();
  return issues
    .map((issue) => {
      const titleTokens = tokens(issue.title);
      const bodyTokens = tokens(issue.body);
      const exactTitle = issue.title.trim().toLowerCase() === normalizedQuery ? 1 : 0;
      const activeBoost = issue.status === "In Progress" || issue.status === "In Review" ? 0.03 : 0;
      const score = exactTitle * 2 + overlap(queryTokens, titleTokens) * 0.7 + overlap(queryTokens, bodyTokens) * 0.27 + activeBoost;
      return { nodeId: issue.nodeId, number: issue.number, status: issue.status, score: Number(score.toFixed(6)) };
    })
    .sort((a, b) => b.score - a.score || a.number - b.number);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

export function buildEligibilityManifest(input: {
  projectRevision: string;
  issues: ProjectIssue[];
  openPullRequests: PullRequest[];
  retrievalPolicyVersion: string;
  query: string;
  capturedAt: string;
}) {
  const nonDoneIssues = input.issues.filter((issue) => issue.status !== "Done");
  const body = {
    projectRevision: input.projectRevision,
    capturedAt: input.capturedAt,
    totalItemCount: input.issues.length,
    nonDoneIssues: nonDoneIssues.map(({ nodeId, number, status, title, labels }) => ({ nodeId, number, status, title, labels })),
    doneHistoryIds: input.issues.filter((issue) => issue.status === "Done").map((issue) => issue.nodeId),
    openPullRequests: input.openPullRequests,
    retrievalPolicyVersion: input.retrievalPolicyVersion,
    rankedCandidates: rankIssueCandidates(input.query, nonDoneIssues),
  };
  return { ...body, digest: createHash("sha256").update(canonical(body)).digest("hex") };
}

