import type { DecisionModel, DecisionRequest, DecisionResult } from "./types";

type ResponsesClient = {
  responses: {
    create: (request: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<{
      id?: string;
      output_text?: string;
      usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
    }>;
  };
};

type ModelProfile = {
  model: string;
  reasoningEffort: string;
  timeoutMs: number;
  schema: Record<string, unknown>;
};

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
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

