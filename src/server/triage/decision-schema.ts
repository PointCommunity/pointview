import { z } from "zod";

const bounded = (max: number) => z.string().min(1).max(max);
const evidenceId = z.string().regex(/^ev_[A-Za-z0-9_-]{8,80}$/);
const riskFlag = z.enum([
  "NEW_ISSUE",
  "LOW_CONFIDENCE",
  "SECURITY",
  "PRIVACY",
  "MULTIPLE_MATCHES",
  "ACTIVE_ISSUE_MATCH",
  "MIXED_FEEDBACK",
]);

const mergeMutation = z.object({
  kind: z.literal("MERGE_COMMENT"),
  issue_node_id: bounded(200).min(8),
  user_evidence_summary: bounded(2000),
  research_findings: z.array(bounded(2000)).min(1).max(20),
  scope_impact: bounded(2000),
}).strict();

const createMutation = z.object({
  kind: z.literal("CREATE_ISSUE"),
  title: bounded(200),
  summary: bounded(3000),
  user_evidence: z.array(bounded(2000)).min(1).max(20),
  research_findings: z.array(bounded(2000)).min(1).max(30),
  scope: z.array(bounded(1000)).min(1).max(30),
  acceptance_criteria: z.array(bounded(1000)).min(1).max(30),
  verification: z.array(bounded(1000)).min(1).max(30),
  out_of_scope: z.array(bounded(1000)).max(30),
  type_label: z.enum(["type:bug", "type:feature", "type:maintenance", "type:security"]),
  area_labels: z.array(z.string().regex(/^area:[a-z0-9-]+$/)).min(1),
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  impact: z.enum(["High", "Medium", "Low"]),
  effort: z.enum(["XS", "S", "M", "L", "XL"]),
}).strict();

const consideredMutation = z.object({
  kind: z.literal("NO_GITHUB_CHANGE"),
  revisit_condition: z.string().max(1000).nullable(),
}).strict();

export const triageDecisionSchema = z.object({
  schema_version: z.literal("1.0.0"),
  record_summary: bounded(1200),
  units: z.array(z.object({
    unit_key: z.string().regex(/^unit-[1-9][0-9]*$/),
    title: bounded(160),
    summary: bounded(2000),
    kind: z.enum(["BUG", "FEATURE", "MAINTENANCE", "SECURITY", "OTHER"]),
    split_reason: z.string().max(500).nullable().optional(),
    disposition: z.enum(["MERGED", "CREATED", "CONSIDERED"]),
    confidence: z.number().min(0).max(1),
    reason_code: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
    rationale: bounded(4000),
    evidence_ids: z.array(evidenceId).min(1).max(40),
    risk_flags: z.array(riskFlag),
    mutation: z.discriminatedUnion("kind", [mergeMutation, createMutation, consideredMutation]),
  }).strict()).min(1).max(8),
}).strict();

export type TriageDecision = z.infer<typeof triageDecisionSchema>;

