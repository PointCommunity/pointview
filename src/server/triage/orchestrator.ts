import type { DecisionModel, DecisionRequest, DecisionResult } from "./model/types";
import type { WebSource } from "./model/web-sources";
import { validateTriageDecision, type DecisionValidationContext } from "./decision-validator";
import { reviewReasons } from "./risk-review";
import type { TriageDecision } from "./decision-schema";

type OrchestrationInput = DecisionRequest & { validationContext: DecisionValidationContext };

export type OrchestrationResult = {
  status: "READY" | "NEEDS_ATTENTION";
  decision: TriageDecision | null;
  proposedDecision: TriageDecision;
  primary: DecisionResult;
  review: DecisionResult | null;
  reviewReasons: string[];
  webSources: WebSource[];
  failureCode: string | null;
};

function mergeWebSources(...groups: WebSource[][]): WebSource[] {
  const byUrl = new Map<string, WebSource>();
  for (const source of groups.flat()) byUrl.set(source.url, source);
  return [...byUrl.values()].sort((left, right) => left.url.localeCompare(right.url));
}

function authoritySignature(decision: TriageDecision): string {
  return JSON.stringify(decision.units.map((unit) => {
    const base = { key: unit.unit_key, kind: unit.kind, disposition: unit.disposition, mutation: unit.mutation.kind };
    if (unit.mutation.kind === "MERGE_COMMENT") return { ...base, target: unit.mutation.issue_node_id };
    if (unit.mutation.kind === "CREATE_ISSUE") return {
      ...base,
      type: unit.mutation.type_label,
      areas: [...unit.mutation.area_labels].sort(),
      priority: unit.mutation.priority,
      impact: unit.mutation.impact,
      effort: unit.mutation.effort,
    };
    return base;
  }));
}

export class DecisionOrchestrator {
  constructor(readonly primaryModel: DecisionModel, readonly reviewModel: DecisionModel) {}

  async decide(input: OrchestrationInput): Promise<OrchestrationResult> {
    const primary = await this.primaryModel.decide({ systemPolicy: input.systemPolicy, evidencePacket: input.evidencePacket });
    const primarySources = mergeWebSources(primary.webSources);
    const primaryDecision = validateTriageDecision(primary.decision, {
      ...input.validationContext,
      webSourceUrls: new Set(primarySources.map((source) => source.url)),
    });
    const reasons = [...new Set(primaryDecision.units.flatMap((unit) => reviewReasons({
      disposition: unit.disposition,
      kind: unit.kind,
      confidence: unit.confidence,
      riskFlags: unit.risk_flags,
    })))];
    if (!reasons.length) {
      return { status: "READY", decision: primaryDecision, proposedDecision: primaryDecision, primary, review: null, reviewReasons: [], webSources: primarySources, failureCode: null };
    }

    const review = await this.reviewModel.decide({
      systemPolicy: `${input.systemPolicy}\nIndependently review the proposed decision for: ${reasons.join(", ")}. ` +
        "Use the same evidence and schema. Do not broaden routing, target, labels, fields, or mutation authority.",
      evidencePacket: { ...input.evidencePacket, proposedDecisionForIndependentReview: primaryDecision },
    });
    const webSources = mergeWebSources(primarySources, review.webSources);
    const reviewDecision = validateTriageDecision(review.decision, {
      ...input.validationContext,
      webSourceUrls: new Set(webSources.map((source) => source.url)),
    });
    if (authoritySignature(primaryDecision) !== authoritySignature(reviewDecision)) {
      return {
        status: "NEEDS_ATTENTION",
        decision: null,
        proposedDecision: primaryDecision,
        primary,
        review,
        reviewReasons: reasons,
        webSources,
        failureCode: "INDEPENDENT_REVIEW_DISAGREEMENT",
      };
    }
    return { status: "READY", decision: primaryDecision, proposedDecision: primaryDecision, primary, review, reviewReasons: reasons, webSources, failureCode: null };
  }
}
