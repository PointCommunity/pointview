import { createHash } from "node:crypto";

import type postgres from "postgres";

import { GitHubAppClient } from "@/server/github/client";
import { collectOpenPullRequests, collectProjectIssues } from "@/server/github/project-reader";

import { BatchSourceSnapshotCache } from "./batch-cache";
import { buildEligibilityManifest } from "./manifest";
import { buildEvidencePacket } from "./packet";
import { collectRepositoryEvidence } from "./repository";

type RecordInput = {
  id: string; sourceAppId: string; sourceSlug: string; sourceVersion: number; feedback: string; environment: string;
  route: string; screen: string; appVersion: string; sourceRevision: string;
};

type Source = {
  id: string; version: number; owner: string; repo: string; projectNodeId: string; projectNumber: number;
  installationId: number; governedLabels: string[];
};

type ProjectEnvelope = {
  data?: { node: null | {
    id: string; number: number;
    items: { nodes: Array<{
      id: string;
      status: null | { name: string };
      content: null | { id: string; number: number; title: string; body: string; repository: { nameWithOwner: string }; labels: { nodes: Array<{ name: string }>; pageInfo: { hasNextPage: boolean } } };
    }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
  } };
  errors?: Array<{ message?: string }>;
};

type Snapshot = { source: Source; client: GitHubAppClient; project: Awaited<ReturnType<typeof collectProjectIssues>>; pullRequests: Awaited<ReturnType<typeof collectOpenPullRequests>> };

type RuntimeResearchDependencies = {
  loadSource?: (record: RecordInput) => Promise<Source>;
  createClient?: (source: Source) => GitHubAppClient;
  collectRepository?: typeof collectRepositoryEvidence;
  now?: () => string;
};

const projectItemsQuery = `query PointViewResearchProject($id: ID!, $cursor: String) {
  node(id: $id) {
    ... on ProjectV2 {
      id number
      items(first: 100, after: $cursor) {
        nodes {
          id
          status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          content {
            ... on Issue {
              id number title body repository { nameWithOwner }
              labels(first: 100) { nodes { name } pageInfo { hasNextPage } }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

export class RuntimeResearchProvider {
  readonly cache = new BatchSourceSnapshotCache<Snapshot>();

  constructor(readonly sql: postgres.Sql, readonly options: {
    appId: number;
    privateKeyPem: string;
    limits: { maxRankedIssues: number; maxFactCharacters: number; maxPacketBytes: number; maxRepositoryFiles: number };
  }, readonly dependencies: RuntimeResearchDependencies = {}) {}

  async #source(record: RecordInput): Promise<Source> {
    if (this.dependencies.loadSource) return this.dependencies.loadSource(record);
    const [source] = await this.sql<Source[]>`
      select id, version, github_owner as owner, github_repo as repo, github_project_node_id as "projectNodeId",
        github_project_number as "projectNumber", github_installation_id::int as "installationId", governed_labels as "governedLabels"
      from source_apps where id = ${record.sourceAppId} and enabled and paused_at is null and validation_status = 'VALID'
    `;
    if (!source || source.version !== record.sourceVersion) throw new Error("Source app registration changed before research");
    return source;
  }

  async #snapshot(record: RecordInput): Promise<Snapshot> {
    return this.cache.get(record.sourceAppId, record.sourceVersion, async () => {
      const source = await this.#source(record);
      const client = this.dependencies.createClient?.(source) ?? new GitHubAppClient({
        appId: this.options.appId,
        installationId: source.installationId,
        privateKeyPem: this.options.privateKeyPem,
        allowedRepositories: new Set([`${source.owner}/${source.repo}`]),
      });
      const project = await collectProjectIssues({ projectNodeId: source.projectNodeId, projectNumber: source.projectNumber }, async (cursor) => {
        const envelope = await client.graphqlJson<ProjectEnvelope>(projectItemsQuery, { id: source.projectNodeId, cursor });
        if (envelope.errors?.length || !envelope.data?.node) throw new Error("GitHub Project research query failed");
        const node = envelope.data.node;
        return {
          project: { nodeId: node.id, number: node.number },
          items: node.items.nodes.map((item) => {
            if (!item.content) return { id: item.id, content: null, status: item.status?.name ?? null, labels: [] };
            if (item.content.repository.nameWithOwner !== `${source.owner}/${source.repo}`) throw new Error("GitHub Project contains an Issue from an unexpected repository");
            if (item.content.labels.pageInfo.hasNextPage) throw new Error("GitHub Issue labels exceed safe research bounds");
            return {
              id: item.id,
              status: item.status?.name ?? null,
              labels: item.content.labels.nodes.map((label) => label.name),
              content: { type: "Issue" as const, nodeId: item.content.id, number: item.content.number, title: item.content.title, body: item.content.body, repository: item.content.repository.nameWithOwner },
            };
          }),
          pageInfo: node.items.pageInfo,
        };
      });
      const pullRequests = await collectOpenPullRequests(client, source.owner, source.repo);
      return { source, client, project, pullRequests };
    });
  }

  async prepare(record: RecordInput) {
    const snapshot = await this.#snapshot(record);
    const capturedAt = this.dependencies.now?.() ?? new Date().toISOString();
    const manifest = buildEligibilityManifest({
      projectRevision: snapshot.project.revision,
      issues: snapshot.project.issues,
      openPullRequests: snapshot.pullRequests,
      retrievalPolicyVersion: "inspect-all-v1",
      query: record.feedback,
      capturedAt,
    });
    const repository = await snapshot.client.withInstallationToken((accessToken) => (this.dependencies.collectRepository ?? collectRepositoryEvidence)({
      repositoryUrl: `https://github.com/${snapshot.source.owner}/${snapshot.source.repo}.git`,
      query: record.feedback,
      maxFiles: this.options.limits.maxRepositoryFiles,
      accessToken,
    }));
    const repositoryEvidence = repository.files.map((file) => ({
      id: `ev_repo_${createHash("sha256").update(`${repository.revision}:${file.path}:${file.digest}`).digest("hex").slice(0, 24)}`,
      kind: "REPOSITORY",
      facts: { revision: repository.revision, path: file.path, excerpt: file.excerpt, digest: file.digest, recentHistory: repository.history },
    }));
    const evidencePacket = buildEvidencePacket({
      feedback: { id: record.id, text: record.feedback, context: { source: record.sourceSlug, environment: record.environment, route: record.route, screen: record.screen, appVersion: record.appVersion, sourceRevision: record.sourceRevision } },
      manifest,
      repositoryEvidence,
      limits: this.options.limits,
    });
    return {
      evidencePacket,
      eligibilityManifest: manifest,
      validationContext: {
        evidenceIds: new Set(evidencePacket.evidence.map((evidence) => evidence.id)),
        eligibleIssues: new Map(manifest.nonDoneIssues.map((issue) => [issue.nodeId, { status: issue.status }])),
        allowedAreaLabels: new Set(snapshot.source.governedLabels.filter((label) => label.startsWith("area:"))),
      },
    };
  }
}
