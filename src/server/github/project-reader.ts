import { createHash } from "node:crypto";

const statuses = new Set(["Backlog", "On Hold", "In Progress", "In Review", "Done"]);

type ProjectIdentity = { projectNodeId: string; projectNumber: number };
type IssueContent = {
  type: "Issue";
  nodeId: string;
  number: number;
  title: string;
  body: string;
  repository: string;
};
type ProjectPage = {
  project: { nodeId: string; number: number };
  items: Array<{ id: string; content: IssueContent | { type: string } | null; status: string | null; labels: string[] }>;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};

function isIssue(content: IssueContent | { type: string }): content is IssueContent {
  return content.type === "Issue" && "nodeId" in content;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

export async function collectProjectIssues(
  expected: ProjectIdentity,
  fetchPage: (cursor: string | null) => Promise<ProjectPage>,
) {
  const issues: Array<IssueContent & { itemId: string; status: string; labels: string[] }> = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await fetchPage(cursor);
    if (page.project.nodeId !== expected.projectNodeId || page.project.number !== expected.projectNumber) {
      throw new Error("GitHub Project identity drifted from the registered target");
    }
    for (const item of page.items) {
      if (!item.content) throw new Error(`Project item ${item.id} is redacted or inaccessible`);
      if (!isIssue(item.content)) continue;
      if (!item.status || !statuses.has(item.status)) throw new Error(`Project Issue ${item.content.nodeId} has missing or unknown Status`);
      if (seen.has(item.content.nodeId)) throw new Error(`Project Issue ${item.content.nodeId} was returned more than once`);
      seen.add(item.content.nodeId);
      issues.push({ ...item.content, itemId: item.id, status: item.status, labels: [...item.labels].sort() });
    }
    if (page.pageInfo.hasNextPage && !page.pageInfo.endCursor) throw new Error("Project pagination did not provide a next cursor");
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  const revision = createHash("sha256").update(canonical(issues)).digest("hex");
  return { issues, revision };
}

export async function collectOpenPullRequests(
  client: { repositoryPages<T>(owner: string, repo: string, path: string): Promise<T[]> },
  owner: string,
  repo: string,
) {
  const rows = await client.repositoryPages<{
    node_id: string;
    number: number;
    title: string;
    body: string | null;
    head: { sha: string; ref: string };
    base: { ref: string };
    updated_at: string;
  }>(owner, repo, "pulls?state=open&per_page=100&sort=updated&direction=desc");
  return rows.map((row) => ({
    nodeId: row.node_id,
    number: row.number,
    title: row.title,
    body: row.body ?? "",
    headSha: row.head.sha,
    headRef: row.head.ref,
    baseRef: row.base.ref,
    updatedAt: row.updated_at,
  }));
}
