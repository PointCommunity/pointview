type ReviewableDecision = {
  disposition: "MERGED" | "CREATED" | "CONSIDERED";
  kind: "BUG" | "FEATURE" | "MAINTENANCE" | "SECURITY" | "OTHER";
  confidence: number;
  riskFlags: string[];
};

const explicitReasons = ["PRIVACY", "MULTIPLE_MATCHES", "ACTIVE_ISSUE_MATCH", "MIXED_FEEDBACK"] as const;

export function reviewReasons(decision: ReviewableDecision): string[] {
  const reasons = new Set<string>();
  if (decision.disposition === "CREATED") reasons.add("NEW_ISSUE");
  if (decision.kind === "SECURITY") reasons.add("SECURITY");
  if (decision.confidence < 0.7) reasons.add("LOW_CONFIDENCE");
  for (const reason of explicitReasons) {
    if (decision.riskFlags.includes(reason)) reasons.add(reason);
  }
  return [...reasons];
}
