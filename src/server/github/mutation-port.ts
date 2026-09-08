import type { GitHubIssueReadback, GitHubMutationPort } from "./apply-decision";
import type { GitHubAppClient } from "./client";
import type { ProjectMutationReadback } from "./preconditions";

type GraphqlEnvelope<T> = { data?: T; errors?: Array<{ message?: string }> };

type ProjectField = { id: string; name: string; options: Array<{ id: string; name: string }> };

type IssueNode = {
  id: string;
  number: number;
  title: string;
  body: string;
  state: "OPEN" | "CLOSED";
  repository: { nameWithOwner: string };
  assignees: { nodes: Array<{ login: string }>; pageInfo: { hasNextPage: boolean } };
  labels: { nodes: Array<{ name: string }>; pageInfo: { hasNextPage: boolean } };
  projectItems: {
    nodes: Array<{
      id: string;
      project: { id: string };
      fieldValues: { nodes: Array<{ name?: string; field?: { name?: string } }> };
    }>;
    pageInfo: { hasNextPage: boolean };
  };
};

function dataOrThrow<T>(envelope: GraphqlEnvelope<T>): T {
  if (envelope.errors?.length || !envelope.data) {
    throw new Error(`GitHub GraphQL failed: ${envelope.errors?.map((error) => error.message ?? "unknown error").join("; ") ?? "missing data"}`);
  }
  return envelope.data;
}

const projectQuery = `query PointViewMutationProject($id: ID!) {
  node(id: $id) {
    ... on ProjectV2 {
      id number public
      fields(first: 100) {
        pageInfo { hasNextPage }
        nodes { ... on ProjectV2SingleSelectField { id name options { id name } } }
      }
    }
  }
}`;

const issueQuery = `query PointViewMutationIssue($id: ID!) {
  node(id: $id) {
    ... on Issue {
      id number title body state repository { nameWithOwner }
      assignees(first: 100) { nodes { login } pageInfo { hasNextPage } }
      labels(first: 100) { nodes { name } pageInfo { hasNextPage } }
      projectItems(first: 100) {
        nodes {
          id project { id }
          fieldValues(first: 100) {
            nodes { ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2SingleSelectField { name } } } }
          }
        }
        pageInfo { hasNextPage }
      }
    }
  }
}`;

export class GitHubMutationAdapter implements GitHubMutationPort {
  constructor(
    readonly client: GitHubAppClient,
    readonly owner: string,
    readonly repo: string,
    readonly projectNodeId: string,
    readonly projectNumber: number,
  ) {}

  get repository(): string {
    return `${this.owner}/${this.repo}`;
  }

  async #project(): Promise<{ id: string; number: number; public: boolean; fields: { nodes: ProjectField[]; pageInfo: { hasNextPage: boolean } } }> {
    const envelope = await this.client.graphqlJson<GraphqlEnvelope<{ node: { id: string; number: number; public: boolean; fields: { nodes: ProjectField[]; pageInfo: { hasNextPage: boolean } } } | null }>>(
      projectQuery,
      { id: this.projectNodeId },
    );
    const project = dataOrThrow(envelope).node;
    if (!project) throw new Error("Registered GitHub Project is missing or inaccessible");
    if (project.fields.pageInfo.hasNextPage) throw new Error("Registered GitHub Project has more than 100 fields and cannot be safely validated");
    return project;
  }

  async readMutationPreconditions(): Promise<ProjectMutationReadback> {
    const [project, labels] = await Promise.all([
      this.#project(),
      this.client.repositoryPages<{ name: string }>(this.owner, this.repo, "labels?per_page=100"),
    ]);
    return {
      nodeId: project.id,
      number: project.number,
      public: project.public,
      repository: this.repository,
      labels: labels.map((label) => label.name),
      fields: Object.fromEntries(project.fields.nodes.map((field) => [field.name, field.options.map((option) => option.name)])),
    };
  }

  async #issueNode(nodeId: string): Promise<IssueNode | null> {
    const envelope = await this.client.graphqlJson<GraphqlEnvelope<{ node: IssueNode | null }>>(issueQuery, { id: nodeId });
    const issue = dataOrThrow(envelope).node;
    if (!issue) return null;
    if (issue.assignees.pageInfo.hasNextPage || issue.labels.pageInfo.hasNextPage || issue.projectItems.pageInfo.hasNextPage) {
      throw new Error("GitHub Issue mutation readback exceeded safe pagination bounds");
    }
    return issue;
  }

  #readback(issue: IssueNode): GitHubIssueReadback {
    const item = issue.projectItems.nodes.find((candidate) => candidate.project.id === this.projectNodeId) ?? null;
    const fields = new Map(item?.fieldValues.nodes.flatMap((value) => value.field?.name && value.name ? [[value.field.name, value.name] as const] : []) ?? []);
    return {
      nodeId: issue.id,
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      assignees: issue.assignees.nodes.map((assignee) => assignee.login),
      labels: issue.labels.nodes.map((label) => label.name),
      projectItemId: item?.id ?? null,
      status: fields.get("Status") ?? null,
      priority: fields.get("Priority") ?? null,
      impact: fields.get("Impact") ?? null,
      effort: fields.get("Effort") ?? null,
      repository: issue.repository.nameWithOwner,
    };
  }

  async findIssueByMarker(marker: string): Promise<GitHubIssueReadback | null> {
    const issues = await this.client.repositoryPages<{ node_id: string; body: string | null; pull_request?: unknown }>(this.owner, this.repo, "issues?state=all&per_page=100");
    const found = issues.find((issue) => !issue.pull_request && issue.body?.includes(marker));
    return found ? this.readIssueByNodeId(found.node_id) : null;
  }

  async createIssue(input: { title: string; body: string }): Promise<GitHubIssueReadback> {
    const created = await this.client.repositoryJson<{ node_id: string }>(this.owner, this.repo, "issues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const readback = await this.readIssueByNodeId(created.node_id);
    if (!readback) throw new Error("Created GitHub Issue could not be read back");
    return readback;
  }

  async setLabels(number: number, labels: string[]): Promise<void> {
    await this.client.repositoryJson(this.owner, this.repo, `issues/${number}/labels`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ labels }),
    });
  }

  async addToProject(number: number): Promise<string> {
    const issue = await this.readIssue(number);
    const envelope = await this.client.graphqlJson<GraphqlEnvelope<{ addProjectV2ItemById: { item: { id: string } } }>>(
      `mutation PointViewAddProjectItem($project: ID!, $content: ID!) {
        addProjectV2ItemById(input: { projectId: $project, contentId: $content }) { item { id } }
      }`,
      { project: this.projectNodeId, content: issue.nodeId },
    );
    return dataOrThrow(envelope).addProjectV2ItemById.item.id;
  }

  async setProjectFields(itemId: string, fields: { status: "Backlog"; priority: string; impact: string; effort: string }): Promise<void> {
    const project = await this.#project();
    const desired = new Map<string, string>([["Status", fields.status], ["Priority", fields.priority], ["Impact", fields.impact], ["Effort", fields.effort]]);
    for (const [name, value] of desired) {
      const field = project.fields.nodes.find((candidate) => candidate.name === name);
      const option = field?.options.find((candidate) => candidate.name === value);
      if (!field || !option) throw new Error(`GitHub Project field ${name} option ${value} is unavailable`);
      const envelope = await this.client.graphqlJson<GraphqlEnvelope<{ updateProjectV2ItemFieldValue: { projectV2Item: { id: string } } }>>(
        `mutation PointViewSetProjectField($project: ID!, $item: ID!, $field: ID!, $option: String!) {
          updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option } }) { projectV2Item { id } }
        }`,
        { project: this.projectNodeId, item: itemId, field: field.id, option: option.id },
      );
      dataOrThrow(envelope);
    }
  }

  async readIssue(number: number): Promise<GitHubIssueReadback> {
    const issue = await this.client.repositoryJson<{ node_id: string }>(this.owner, this.repo, `issues/${number}`);
    const readback = await this.readIssueByNodeId(issue.node_id);
    if (!readback) throw new Error(`GitHub Issue #${number} is missing or inaccessible`);
    return readback;
  }

  async readIssueByNodeId(nodeId: string): Promise<GitHubIssueReadback | null> {
    const issue = await this.#issueNode(nodeId);
    return issue ? this.#readback(issue) : null;
  }

  async findCommentByMarker(issueNodeId: string, marker: string) {
    const issue = await this.readIssueByNodeId(issueNodeId);
    if (!issue) return null;
    const comments = await this.client.repositoryPages<{ node_id: string; body: string }>(this.owner, this.repo, `issues/${issue.number}/comments?per_page=100`);
    const comment = comments.find((candidate) => candidate.body.includes(marker));
    return comment ? { id: comment.node_id, issueNodeId, body: comment.body } : null;
  }

  async createComment(issueNodeId: string, body: string) {
    const issue = await this.readIssueByNodeId(issueNodeId);
    if (!issue) throw new Error("Merge target disappeared before comment creation");
    const comment = await this.client.repositoryJson<{ node_id: string; body: string }>(this.owner, this.repo, `issues/${issue.number}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    });
    return { id: comment.node_id, issueNodeId, body: comment.body };
  }

  async readComment(id: string) {
    const envelope = await this.client.graphqlJson<GraphqlEnvelope<{ node: { id: string; body: string; issue: { id: string } } | null }>>(
      `query PointViewMutationComment($id: ID!) { node(id: $id) { ... on IssueComment { id body issue { id } } } }`,
      { id },
    );
    const comment = dataOrThrow(envelope).node;
    return comment ? { id: comment.id, issueNodeId: comment.issue.id, body: comment.body } : null;
  }
}
