export type EvidencePacket = {
  evidence: Array<{
    id: string;
    kind: string;
    facts: Record<string, unknown>;
  }>;
  [key: string]: unknown;
};

export type DecisionRequest = {
  systemPolicy: string;
  evidencePacket: EvidencePacket;
};

import type { WebSource } from "./web-sources";

export type DecisionResult = {
  decision: unknown;
  responseId: string | null;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  webSources: WebSource[];
};

export interface DecisionModel {
  decide(request: DecisionRequest): Promise<DecisionResult>;
}
