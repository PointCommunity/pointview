import type { DecisionModel, DecisionRequest, DecisionResult } from "./types";
import { normalizeWebSourceUrl, webSourceId, type WebSource } from "./web-sources";

type CodexIsolation = {
  sandboxMode: "read-only";
  approvalPolicy: "never";
  networkAccessEnabled: false;
  webSearchMode: "live";
  ephemeral: true;
  loadUserConfig: false;
  loadProjectRules: false;
};

export type CodexRunOptions = {
  credential: string;
  model: string;
  reasoningEffort: string;
  timeoutMs: number;
  systemPolicy: string;
  evidencePacket: DecisionRequest["evidencePacket"];
  images?: DecisionRequest["images"];
  outputSchema: Record<string, unknown>;
  isolation: CodexIsolation;
};

export type CodexRunResult = {
  finalResponse: string;
  usage: { input_tokens: number; output_tokens: number } | null;
  items: Array<{ type: string; [key: string]: unknown }>;
  refreshedCredential: string | null;
};

export interface CodexRuntime {
  run(options: CodexRunOptions): Promise<CodexRunResult>;
}

type CodexProfile = {
  credential: string;
  model: string;
  reasoningEffort: string;
  timeoutMs: number;
  schema: Record<string, unknown>;
  supportsImages: boolean;
  onCredentialRefreshed(credential: string): Promise<void>;
};

const isolation: CodexIsolation = {
  sandboxMode: "read-only",
  approvalPolicy: "never",
  networkAccessEnabled: false,
  webSearchMode: "live",
  ephemeral: true,
  loadUserConfig: false,
  loadProjectRules: false,
};

const forbiddenItemTypes = new Set(["command_execution", "file_change", "mcp_tool_call"]);

function schemaScalarType(value: unknown): "string" | "number" | "boolean" | "null" | undefined {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return undefined;
}

function codexOutputSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(codexOutputSchema);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const result = Object.fromEntries(Object.entries(source).map(([key, entry]) => [key, codexOutputSchema(entry)]));
  if (!("type" in result)) {
    const constType = "const" in source ? schemaScalarType(source.const) : undefined;
    const enumTypes = Array.isArray(source.enum) ? [...new Set(source.enum.map(schemaScalarType))] : [];
    const enumType = enumTypes.length === 1 ? enumTypes[0] : undefined;
    if (constType || enumType) result.type = constType ?? enumType;
  }
  return result;
}

function citedWebSources(decision: unknown): WebSource[] {
  if (!decision || typeof decision !== "object" || !("units" in decision) || !Array.isArray(decision.units)) return [];
  const byUrl = new Map<string, WebSource>();
  for (const unit of decision.units) {
    if (!unit || typeof unit !== "object" || !("mutation" in unit) || !unit.mutation || typeof unit.mutation !== "object" || !("research_findings" in unit.mutation) || !Array.isArray(unit.mutation.research_findings)) continue;
    for (const finding of unit.mutation.research_findings) {
      if (!finding || typeof finding !== "object" || !("source_urls" in finding) || !Array.isArray(finding.source_urls)) continue;
      for (const candidate of finding.source_urls) {
        if (typeof candidate !== "string") continue;
        const url = normalizeWebSourceUrl(candidate);
        if (url) byUrl.set(url, { id: webSourceId(url), url, title: new URL(url).hostname });
      }
    }
  }
  return [...byUrl.values()].sort((left, right) => left.url.localeCompare(right.url));
}

export class CodexDecisionModel implements DecisionModel {
  constructor(readonly runtime: CodexRuntime, readonly profile: CodexProfile) {}

  async decide(request: DecisionRequest): Promise<DecisionResult> {
    const result = await this.runtime.run({
      credential: this.profile.credential,
      model: this.profile.model,
      reasoningEffort: this.profile.reasoningEffort,
      timeoutMs: this.profile.timeoutMs,
      systemPolicy: request.systemPolicy,
      evidencePacket: request.evidencePacket,
      images: this.profile.supportsImages ? request.images : undefined,
      outputSchema: codexOutputSchema(this.profile.schema) as Record<string, unknown>,
      isolation,
    });
    if (result.items.some((item) => forbiddenItemTypes.has(item.type))) {
      throw new Error("Codex attempted a forbidden tool operation");
    }
    let decision: unknown;
    try {
      decision = JSON.parse(result.finalResponse);
    } catch {
      throw new Error("Decision model returned invalid JSON");
    }
    if (result.refreshedCredential && result.refreshedCredential !== this.profile.credential) {
      await this.profile.onCredentialRefreshed(result.refreshedCredential);
    }
    const inputTokens = result.usage?.input_tokens ?? 0;
    const outputTokens = result.usage?.output_tokens ?? 0;
    return {
      decision,
      responseId: null,
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      webSources: citedWebSources(decision),
    };
  }
}
