import { triageDecisionSchema, type TriageDecision } from "./decision-schema";
import { normalizeWebSourceUrl } from "./model/web-sources";

export type DecisionValidationContext = {
  evidenceIds: Set<string>;
  eligibleIssues: Map<string, { status: string }>;
  allowedAreaLabels: Set<string>;
  webSourceUrls?: Set<string>;
};

const unsafeInstruction = /(?:ignore (?:all |the )?(?:previous|prior) instructions|system prompt|developer message|github token|api key|run (?:a )?(?:shell|command)|exfiltrat)/i;
const personalEmail = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

function textValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(textValues);
  return [];
}

export function validateTriageDecision(value: unknown, context: DecisionValidationContext): TriageDecision {
  const decision = triageDecisionSchema.parse(value);
  const unsafe = textValues(decision).find((text) => unsafeInstruction.test(text) || personalEmail.test(text));
  if (unsafe) throw new Error("Decision contains unsafe or privacy-sensitive content");

  const expectedKeys = decision.units.map((_, index) => `unit-${index + 1}`);
  if (JSON.stringify(decision.units.map((unit) => unit.unit_key)) !== JSON.stringify(expectedKeys)) {
    throw new Error("Decision unit keys must be unique and sequential");
  }
  const mixed = decision.units.length > 1;
  for (const unit of decision.units) {
    if (new Set(unit.evidence_ids).size !== unit.evidence_ids.length || unit.evidence_ids.some((id) => !context.evidenceIds.has(id))) {
      throw new Error("Decision references unavailable evidence");
    }
    if (new Set(unit.risk_flags).size !== unit.risk_flags.length) throw new Error("Decision risk flags must be unique");
    if (mixed && (!unit.split_reason || !unit.risk_flags.includes("MIXED_FEEDBACK"))) {
      throw new Error("Mixed feedback units require split lineage and risk flag");
    }
    if (unit.confidence < 0.7 && !unit.risk_flags.includes("LOW_CONFIDENCE")) {
      throw new Error("Low-confidence decisions require independent review");
    }
    if (unit.kind === "SECURITY" && !unit.risk_flags.includes("SECURITY")) {
      throw new Error("Security decisions require independent review");
    }
    const findings = unit.mutation.kind === "NO_GITHUB_CHANGE" ? [] : unit.mutation.research_findings;
    for (const finding of findings) {
      if (!finding.evidence_ids.length && !finding.source_urls.length) throw new Error("Research findings require evidence or web sources");
      if (new Set(finding.evidence_ids).size !== finding.evidence_ids.length || finding.evidence_ids.some((id) => !context.evidenceIds.has(id))) {
        throw new Error("Research finding references unavailable evidence");
      }
      if (new Set(finding.source_urls).size !== finding.source_urls.length || finding.source_urls.some((url) => {
        const normalized = normalizeWebSourceUrl(url);
        return !normalized || !context.webSourceUrls?.has(normalized);
      })) {
        throw new Error("Research finding references an uncaptured web source");
      }
    }
    if (unit.disposition === "MERGED") {
      if (unit.mutation.kind !== "MERGE_COMMENT") throw new Error("Disposition and mutation kind do not match");
      const target = context.eligibleIssues.get(unit.mutation.issue_node_id);
      if (!target || target.status === "Done") throw new Error("Merge target is not an eligible non-Done Issue");
      if ((target.status === "In Progress" || target.status === "In Review") && !unit.risk_flags.includes("ACTIVE_ISSUE_MATCH")) {
        throw new Error("Active Issue matches require independent review");
      }
    } else if (unit.disposition === "CREATED") {
      if (unit.mutation.kind !== "CREATE_ISSUE") throw new Error("Disposition and mutation kind do not match");
      if (!unit.risk_flags.includes("NEW_ISSUE")) throw new Error("New Issues require independent review");
      for (const label of unit.mutation.area_labels) {
        if (!context.allowedAreaLabels.has(label)) throw new Error(`Area label ${label} is not registered`);
      }
    } else if (unit.mutation.kind !== "NO_GITHUB_CHANGE") {
      throw new Error("Disposition and mutation kind do not match");
    }
  }
  return decision;
}
