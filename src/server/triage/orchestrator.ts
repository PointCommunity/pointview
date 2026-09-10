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

const correctionPolicy = "The previous structured response could not pass deterministic validation. " +
  "Return one corrected response using only the supplied evidence and eligible targets. Ensure unit keys are sequential, " +
  "all evidence IDs and source URLs are captured, dispositions match mutations, and required risk flags and registered labels are exact. " +
  "Do not mention or repeat the previous response.";

async function decideValidated(
  model: DecisionModel,
  request: DecisionRequest,
  validationContext: DecisionValidationContext,
): Promise<{ result: DecisionResult; decision: TriageDecision; sources: WebSource[] }> {
  const first = await model.decide(request);
  const firstSources = mergeWebSources(first.webSources);
  try {
    return {
      result: first,
      decision: validateTriageDecision(first.decision, {
        ...validationContext,
        webSourceUrls: new Set(firstSources.map((source) => source.url)),
      }),
      sources: firstSources,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "Decision contains unsafe or privacy-sensitive content") throw error;
    const repaired = await model.decide({
      ...request,
      systemPolicy: `${request.systemPolicy}\n${correctionPolicy}`,
    });
    const repairedSources = mergeWebSources(repaired.webSources);
    const decision = validateTriageDecision(repaired.decision, {
      ...validationContext,
      webSourceUrls: new Set(repairedSources.map((source) => source.url)),
    });
    return {
      result: {
        ...repaired,
        usage: {
          inputTokens: first.usage.inputTokens + repaired.usage.inputTokens,
          outputTokens: first.usage.outputTokens + repaired.usage.outputTokens,
          totalTokens: first.usage.totalTokens + repaired.usage.totalTokens,
        },
      },
      decision,
      sources: repairedSources,
    };
  }
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
    const primaryResult = await decideValidated(this.primaryModel, {
      systemPolicy: input.systemPolicy,
      evidencePacket: input.evidencePacket,
      images: input.images,
    }, input.validationContext);
    const { result: primary, decision: primaryDecision, sources: primarySources } = primaryResult;
    const reasons = [...new Set(primaryDecision.units.flatMap((unit) => reviewReasons({
      disposition: unit.disposition,
      kind: unit.kind,
      confidence: unit.confidence,
      riskFlags: unit.risk_flags,
    })))];
    if (!reasons.length) {
      return { status: "READY", decision: primaryDecision, proposedDecision: primaryDecision, primary, review: null, reviewReasons: [], webSources: primarySources, failureCode: null };
    }

    const reviewResult = await decideValidated(this.reviewModel, {
      systemPolicy: `${input.systemPolicy}\nIndependently review the proposed decision for: ${reasons.join(", ")}. ` +
        "Use the same evidence and schema. Do not broaden routing, target, labels, fields, or mutation authority.",
      evidencePacket: { ...input.evidencePacket, proposedDecisionForIndependentReview: primaryDecision },
      images: input.images,
    }, input.validationContext);
    const { result: review, decision: reviewDecision, sources: reviewSources } = reviewResult;
    const webSources = mergeWebSources(primarySources, reviewSources);
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
