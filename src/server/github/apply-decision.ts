import { assertMergePreconditions, assertProjectPreconditions, type ProjectMutationExpectation, type ProjectMutationReadback } from "./preconditions";

export type GitHubIssueReadback = {
  nodeId: string;
  number: number;
  title: string;
  body: string;
  state: "OPEN" | "CLOSED";
  assignees: string[];
  labels: string[];
  projectItemId: string | null;
  status: string | null;
  priority: string | null;
  impact: string | null;
  effort: string | null;
  repository: string;
};

type Comment = { id: string; issueNodeId: string; body: string };

export interface GitHubMutationPort {
  readMutationPreconditions(): Promise<ProjectMutationReadback>;
  findIssueByMarker(marker: string): Promise<GitHubIssueReadback | null>;
  createIssue(input: { title: string; body: string }): Promise<GitHubIssueReadback>;
  setLabels(number: number, labels: string[]): Promise<void>;
  addToProject(number: number): Promise<string>;
  setProjectFields(itemId: string, fields: { status: "Backlog"; priority: string; impact: string; effort: string }): Promise<void>;
  readIssue(number: number): Promise<GitHubIssueReadback>;
  readIssueByNodeId(nodeId: string): Promise<GitHubIssueReadback | null>;
  findCommentByMarker(issueNodeId: string, marker: string): Promise<Comment | null>;
  createComment(issueNodeId: string, body: string): Promise<Comment>;
  readComment(id: string): Promise<Comment | null>;
}

export type OperationRecord = {
  key: string;
  state: "PENDING" | "CONFIRMED";
  githubIssueNumber?: number;
  githubCommentId?: string;
  readback?: unknown;
};

export interface OperationLedger {
  get(key: string): Promise<OperationRecord | undefined>;
  put(record: OperationRecord): Promise<void>;
}

export class MemoryOperationLedger implements OperationLedger {
  readonly records = new Map<string, OperationRecord>();
  async get(key: string) {
    return this.records.get(key);
  }
  async put(record: OperationRecord) {
    this.records.set(record.key, structuredClone(record));
  }
}

function marker(operationId: string): string {
  return `<!-- pointview-operation:${operationId} -->`;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item) => right.includes(item));
}

export async function applyCreate(
  input: {
    decisionId: string;
    operationId: string;
    title: string;
    body: string;
    labels: string[];
    fields: { status: "Backlog"; priority: string; impact: string; effort: string };
    expectedRepository: string;
    expectedProject: { nodeId: string; number: number };
  },
  github: GitHubMutationPort,
  ledger: OperationLedger,
): Promise<GitHubIssueReadback> {
  const key = `create:${input.decisionId}`;
  const recorded = await ledger.get(key);
  if (recorded?.state === "CONFIRMED") return recorded.readback as GitHubIssueReadback;
  const operationMarker = marker(input.operationId);
  if (!input.body.includes(operationMarker)) throw new Error("Created Issue body is missing its operation marker");
  const expectation: ProjectMutationExpectation = {
    expectedRepository: input.expectedRepository,
    expectedProject: input.expectedProject,
    requiredLabels: input.labels,
    requiredFields: input.fields,
  };

  let issue = recorded?.githubIssueNumber ? await github.readIssue(recorded.githubIssueNumber) : await github.findIssueByMarker(operationMarker);
  if (!issue) {
    assertProjectPreconditions(expectation, await github.readMutationPreconditions());
    await ledger.put({ key, state: "PENDING" });
    issue = await github.createIssue({ title: input.title, body: input.body });
  }
  await ledger.put({ key, state: "PENDING", githubIssueNumber: issue.number });
  assertProjectPreconditions(expectation, await github.readMutationPreconditions());
  await github.setLabels(issue.number, input.labels);
  const refreshed = await github.readIssue(issue.number);
  let itemId = refreshed.projectItemId;
  if (!itemId) {
    assertProjectPreconditions(expectation, await github.readMutationPreconditions());
    itemId = await github.addToProject(issue.number);
  }
  assertProjectPreconditions(expectation, await github.readMutationPreconditions());
  await github.setProjectFields(itemId, input.fields);
  const readback = await github.readIssue(issue.number);
  if (
    readback.title !== input.title ||
    !readback.body.includes(operationMarker) ||
    readback.state !== "OPEN" ||
    readback.assignees.length !== 0 ||
    !sameSet(readback.labels, input.labels) ||
    readback.status !== "Backlog" ||
    readback.priority !== input.fields.priority ||
    readback.impact !== input.fields.impact ||
    readback.effort !== input.fields.effort
  ) {
    throw new Error("Created Issue readback does not match the authorized mutation");
  }
  await ledger.put({ key, state: "CONFIRMED", githubIssueNumber: issue.number, readback });
  return readback;
}

export async function applyMerge(
  input: { decisionId: string; operationId: string; targetIssueNodeId: string; expectedRepository: string; body: string },
  github: GitHubMutationPort,
  ledger: OperationLedger,
): Promise<Comment> {
  const key = `merge:${input.decisionId}`;
  const recorded = await ledger.get(key);
  if (recorded?.state === "CONFIRMED") return recorded.readback as Comment;
  const target = await github.readIssueByNodeId(input.targetIssueNodeId);
  assertMergePreconditions(input.expectedRepository, target);
  const operationMarker = marker(input.operationId);
  if (!input.body.includes(operationMarker)) throw new Error("Merge comment is missing its operation marker");
  let comment = recorded?.githubCommentId ? await github.readComment(recorded.githubCommentId) : await github.findCommentByMarker(target!.nodeId, operationMarker);
  if (!comment) {
    assertMergePreconditions(input.expectedRepository, await github.readIssueByNodeId(input.targetIssueNodeId));
    await ledger.put({ key, state: "PENDING" });
    comment = await github.createComment(target!.nodeId, input.body);
  }
  await ledger.put({ key, state: "PENDING", githubCommentId: comment.id });
  const readback = await github.readComment(comment.id);
  if (!readback || readback.issueNodeId !== target!.nodeId || readback.body !== input.body) {
    throw new Error("Merge comment readback does not match the authorized mutation");
  }
  await ledger.put({ key, state: "CONFIRMED", githubCommentId: comment.id, readback });
  return readback;
}

export async function applyConsidered(
  input: { decisionId: string; operationId: string; reasonCode: string },
  ledger: OperationLedger,
) {
  const record = {
    key: `considered:${input.decisionId}`,
    state: "CONFIRMED" as const,
    readback: { operationId: input.operationId, reasonCode: input.reasonCode, githubMutation: false },
  };
  await ledger.put(record);
  return record.readback;
}
