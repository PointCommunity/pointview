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
  images?: Array<{
    evidenceId: string;
    mediaType: "image/png" | "image/jpeg" | "image/webp";
    bytes: Uint8Array;
  }>;
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
