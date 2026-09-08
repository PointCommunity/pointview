import type { DecisionModel, DecisionRequest, DecisionResult } from "./types";
import { normalizeWebSourceUrl, webSourceId } from "./web-sources";

type ResponsesClient = {
  responses: {
    create: (request: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<{
      id?: string;
      output_text?: string;
      output?: Array<{
        type: string;
        action?: { type?: string; url?: string | null; sources?: Array<{ type: string; url: string }> };
        content?: Array<{ type: string; annotations?: Array<{ type: string; url?: string; title?: string }> }>;
      }>;
      usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
    }>;
  };
};

type ModelProfile = {
  model: string;
  reasoningEffort: string;
  timeoutMs: number;
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
};

function extractWebSources(output: NonNullable<Awaited<ReturnType<ResponsesClient["responses"]["create"]>>["output"]>) {
  const sources = new Map<string, string>();
  const add = (value: string | null | undefined, title?: string) => {
    if (!value) return;
    const url = normalizeWebSourceUrl(value);
    if (!url) return;
    const safeTitle = title?.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 300) || new URL(url).hostname;
    if (!sources.has(url) || title) sources.set(url, safeTitle);
  };
  for (const item of output) {
    if (item.type === "web_search_call") {
      item.action?.sources?.forEach((source) => source.type === "url" && add(source.url));
      add(item.action?.url);
    }
    if (item.type === "message") {
      item.content?.forEach((part) => part.annotations?.forEach((annotation) => {
        if (annotation.type === "url_citation") add(annotation.url, annotation.title);
      }));
    }
  }
  return [...sources.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([url, title]) => ({
    id: webSourceId(url),
    url,
    title,
  }));
}

export class OpenAiDecisionModel implements DecisionModel {
  constructor(readonly client: ResponsesClient, readonly profile: ModelProfile) {}

  async decide(request: DecisionRequest): Promise<DecisionResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.profile.timeoutMs);
    try {
      const response = await this.client.responses.create(
        {
          model: this.profile.model,
          store: false,
          reasoning: { effort: this.profile.reasoningEffort },
          tools: [{ type: "web_search" }],
          tool_choice: "auto",
          include: ["web_search_call.action.sources"],
          ...(this.profile.maxOutputTokens ? { max_output_tokens: this.profile.maxOutputTokens } : {}),
          input: [
            { role: "system", content: [{ type: "input_text", text: request.systemPolicy }] },
            { role: "user", content: [{ type: "input_text", text: JSON.stringify(request.evidencePacket) }] },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "pointview_triage_decision",
              strict: true,
              schema: this.profile.schema,
            },
          },
        },
        { signal: controller.signal },
      );
      if (!response.output_text) throw new Error("Decision model returned no structured output");
      let decision: unknown;
      try {
        decision = JSON.parse(response.output_text);
      } catch {
        throw new Error("Decision model returned invalid JSON");
      }
      return {
        decision,
        responseId: response.id ?? null,
        usage: {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
        webSources: extractWebSources(response.output ?? []),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
