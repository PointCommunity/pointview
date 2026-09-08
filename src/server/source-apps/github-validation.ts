import { createHash } from "node:crypto";

import { z } from "zod";

import type { GitHubAppClient } from "@/server/github/client";

import type { SourceAppInput, SourceValidation } from "./service";
import { validateSourceTarget } from "./validation";

const repositorySchema = z.object({ name: z.string(), private: z.boolean(), owner: z.object({ login: z.string() }) });
const labelSchema = z.object({ name: z.string() });
const projectSchema = z.object({
  data: z.object({
    node: z.object({
      id: z.string(),
      number: z.number().int().positive(),
      public: z.boolean(),
      fields: z.object({
        pageInfo: z.object({ hasNextPage: z.boolean() }),
        nodes: z.array(z.object({ name: z.string(), options: z.array(z.object({ name: z.string() })) }).nullable()),
      }),
    }).nullable(),
  }),
  errors: z.array(z.unknown()).optional(),
});

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

export async function validateGitHubSourceTarget(client: GitHubAppClient, input: SourceAppInput): Promise<SourceValidation> {
  try {
    const [repositoryRaw, installationId, labelsRaw, projectRaw] = await Promise.all([
      client.repositoryJson(input.githubOwner, input.githubRepo, ""),
      client.repositoryInstallationId(input.githubOwner, input.githubRepo),
      client.repositoryPages(input.githubOwner, input.githubRepo, "labels?per_page=100"),
      client.projectReadback(input.githubProjectNodeId),
    ]);
    const repository = repositorySchema.parse(repositoryRaw);
    const labels = z.array(labelSchema).parse(labelsRaw).map((label) => label.name).sort();
    const projectResult = projectSchema.parse(projectRaw);
    if (projectResult.errors?.length || !projectResult.data.node) return { valid: false, errors: ["Project is inaccessible"] };
    if (projectResult.data.node.fields.pageInfo.hasNextPage) return { valid: false, errors: ["Project field readback exceeded the bounded validation page"] };
    const fields = Object.fromEntries(projectResult.data.node.fields.nodes.filter((field) => field !== null).map((field) => [field.name, field.options.map((option) => option.name)]));
    const readback = {
      repository: { owner: repository.owner.login, name: repository.name, private: repository.private, installationId },
      project: {
        nodeId: projectResult.data.node.id,
        number: projectResult.data.node.number,
        private: !projectResult.data.node.public,
        fields,
      },
      labels,
    };
    const result = validateSourceTarget({
      githubOwner: input.githubOwner,
      githubRepo: input.githubRepo,
      installationId: input.githubInstallationId,
      projectNodeId: input.githubProjectNodeId,
      projectNumber: input.githubProjectNumber,
      governedLabels: input.governedLabels,
    }, readback);
    return { ...result, ...(result.valid ? { digest: createHash("sha256").update(canonical(readback)).digest("hex") } : {}) };
  } catch {
    return { valid: false, errors: ["GitHub target readback failed"] };
  }
}
