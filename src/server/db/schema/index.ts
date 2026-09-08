import {
  bigint,
  bigserial,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const citext = customType<{ data: string }>({ dataType: () => "citext" });
const time = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const accountRole = pgEnum("account_role", ["USER", "ADMIN", "OWNER"]);
export const accountStatus = pgEnum("account_status", ["PENDING", "ACTIVE", "SUSPENDED"]);
export const feedbackState = pgEnum("feedback_state", [
  "QUEUED", "LEASED", "RESEARCHING", "DECIDING", "APPLYING", "TRIAGED", "NEEDS_ATTENTION", "WITHDRAWN",
]);
export const batchState = pgEnum("batch_state", ["RUNNING", "COMPLETED", "STOPPED", "FAILED"]);
export const unitState = pgEnum("unit_state", ["RESEARCHING", "DECIDING", "VALIDATING", "APPLYING", "TERMINAL", "NEEDS_ATTENTION"]);
export const disposition = pgEnum("disposition", ["MERGED", "CREATED", "CONSIDERED"]);
export const decisionState = pgEnum("decision_state", [
  "DRAFT", "SCHEMA_VALID", "EVIDENCE_VALID", "PRECONDITIONS_VALID", "APPLYING", "READBACK_CONFIRMED", "TERMINAL", "INVALID",
]);
export const operationState = pgEnum("operation_state", ["PENDING", "SENT", "CONFIRMED", "RETRYABLE", "FAILED"]);

export const accounts = pgTable("accounts", {
  id: uuid().primaryKey(),
  accessSubjectHash: text("access_subject_hash").notNull().unique(),
  emailNormalized: citext("email_normalized").notNull().unique(),
  displayName: text("display_name").notNull(),
  role: accountRole().notNull().default("USER"),
  status: accountStatus().notNull().default("PENDING"),
  version: integer().notNull().default(1),
  createdAt: time("created_at").notNull().defaultNow(),
  approvedAt: time("approved_at"),
  suspendedAt: time("suspended_at"),
  lastSeenAt: time("last_seen_at"),
});

export const modelProfiles = pgTable("model_profiles", {
  id: uuid().primaryKey(),
  provider: text().notNull(),
  modelIdentifier: text("model_identifier").notNull(),
  reasoningEffort: text("reasoning_effort").notNull(),
  maxInputTokens: integer("max_input_tokens").notNull(),
  maxOutputTokens: integer("max_output_tokens").notNull(),
  timeoutMs: integer("timeout_ms").notNull(),
  active: boolean().notNull().default(false),
  secretReference: text("secret_reference").notNull(),
  promptVersion: text("prompt_version").notNull(),
  promptDigest: text("prompt_digest").notNull(),
  schemaVersion: text("schema_version").notNull(),
  schemaDigest: text("schema_digest").notNull(),
  version: integer().notNull().default(1),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});

export const applicationSettings = pgTable("application_settings", {
  id: uuid().primaryKey(),
  version: integer().notNull().unique(),
  triagePaused: boolean("triage_paused").notNull().default(false),
  triagePauseReason: text("triage_pause_reason"),
  observedSchedule: text("observed_schedule").notNull(),
  rawRetentionDays: integer("raw_retention_days").notNull().default(180),
  modelProfileId: uuid("model_profile_id").references(() => modelProfiles.id),
  riskReviewPolicyVersion: text("risk_review_policy_version").notNull(),
  retrievalLimits: jsonb("retrieval_limits").notNull(),
  promptVersion: text("prompt_version").notNull(),
  schemaVersion: text("schema_version").notNull(),
  effectiveFrom: time("effective_from").notNull().defaultNow(),
  supersededAt: time("superseded_at"),
  createdAt: time("created_at").notNull().defaultNow(),
});

export const sourceApps = pgTable("source_apps", {
  id: uuid().primaryKey(),
  slug: text().notNull().unique(),
  displayName: text("display_name").notNull(),
  enabled: boolean().notNull().default(false),
  githubOwner: text("github_owner").notNull(),
  githubRepo: text("github_repo").notNull(),
  githubProjectNodeId: text("github_project_node_id").notNull(),
  githubProjectNumber: integer("github_project_number").notNull(),
  githubInstallationId: bigint("github_installation_id", { mode: "number" }).notNull(),
  allowedOrigins: text("allowed_origins").array().notNull(),
  returnUrlPrefixes: text("return_url_prefixes").array().notNull(),
  governedLabels: text("governed_labels").array().notNull(),
  validationStatus: text("validation_status").notNull().default("UNKNOWN"),
  validationCheckedAt: time("validation_checked_at"),
  validationDigest: text("validation_digest"),
  pausedAt: time("paused_at"),
  pauseReason: text("pause_reason"),
  version: integer().notNull().default(1),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});

export const sourceAppKeys = pgTable("source_app_keys", {
  id: uuid().primaryKey(),
  sourceAppId: uuid("source_app_id").notNull().references(() => sourceApps.id, { onDelete: "cascade" }),
  kid: text().notNull(),
  algorithm: text().notNull().default("EdDSA"),
  publicJwk: jsonb("public_jwk").notNull(),
  fingerprint: text().notNull(),
  notBefore: time("not_before").notNull(),
  notAfter: time("not_after").notNull(),
  revokedAt: time("revoked_at"),
  createdAt: time("created_at").notNull().defaultNow(),
}, (table) => [uniqueIndex("source_app_keys_source_kid").on(table.sourceAppId, table.kid)]);

export const launchSessions = pgTable("launch_sessions", {
  id: uuid().primaryKey(),
  sourceAppId: uuid("source_app_id").notNull().references(() => sourceApps.id),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  environment: text().notNull(),
  route: text().notNull(),
  screen: text().notNull(),
  appVersion: text("app_version").notNull(),
  sourceRevision: text("source_revision").notNull(),
  returnUrl: text("return_url").notNull(),
  tokenFingerprint: text("token_fingerprint").notNull().unique(),
  createdAt: time("created_at").notNull().defaultNow(),
  expiresAt: time("expires_at").notNull(),
  consumedAt: time("consumed_at"),
});

export const launchNonces = pgTable("launch_nonces", {
  id: uuid().primaryKey(),
  sourceAppId: uuid("source_app_id").notNull().references(() => sourceApps.id, { onDelete: "cascade" }),
  nonceHash: customType<{ data: Buffer }>({ dataType: () => "bytea" })("nonce_hash").notNull(),
  issuedAt: time("issued_at").notNull(),
  expiresAt: time("expires_at").notNull(),
  consumedAt: time("consumed_at"),
  launchSessionId: uuid("launch_session_id").references(() => launchSessions.id),
}, (table) => [uniqueIndex("launch_nonces_source_digest").on(table.sourceAppId, table.nonceHash)]);

export const feedbackRecords = pgTable("feedback_records", {
  id: uuid().primaryKey(),
  sequence: bigserial({ mode: "number" }).notNull().unique(),
  submitterAccountId: uuid("submitter_account_id").notNull().references(() => accounts.id),
  sourceAppId: uuid("source_app_id").notNull().references(() => sourceApps.id),
  launchSessionId: uuid("launch_session_id").notNull().unique().references(() => launchSessions.id),
  environment: text().notNull(),
  route: text().notNull(),
  screen: text().notNull(),
  appVersion: text("app_version").notNull(),
  sourceRevision: text("source_revision").notNull(),
  state: feedbackState().notNull().default("QUEUED"),
  submittedAt: time("submitted_at").notNull().defaultNow(),
  triageTerminalAt: time("triage_terminal_at"),
  rawDeleteAfter: time("raw_delete_after"),
  rawDeletedAt: time("raw_deleted_at"),
  withdrawnAt: time("withdrawn_at"),
  correlationId: uuid("correlation_id").notNull().unique(),
}, (table) => [
  index("feedback_records_queue_idx").on(table.state, table.sequence),
  index("feedback_records_retention_idx").on(table.rawDeleteAfter),
]);

export const feedbackPayloads = pgTable("feedback_payloads", {
  feedbackRecordId: uuid("feedback_record_id").primaryKey().references(() => feedbackRecords.id, { onDelete: "cascade" }),
  feedbackText: text("feedback_text").notNull(),
  policyVersion: text("policy_version").notNull(),
  contentDigest: text("content_digest").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});

export const attachments = pgTable("attachments", {
  id: uuid().primaryKey(),
  feedbackRecordId: uuid("feedback_record_id").notNull().references(() => feedbackRecords.id, { onDelete: "cascade" }),
  ordinal: smallint().notNull(),
  displayName: text("display_name").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  width: integer().notNull(),
  height: integer().notNull(),
  sha256: customType<{ data: Buffer }>({ dataType: () => "bytea" })().notNull(),
  storageKey: text("storage_key").notNull().unique(),
  decodeStatus: text("decode_status").notNull(),
  scanStatus: text("scan_status").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
  lastAuthorizedAccessAt: time("last_authorized_access_at"),
  deletedAt: time("deleted_at"),
}, (table) => [uniqueIndex("attachments_record_ordinal").on(table.feedbackRecordId, table.ordinal)]);

export const feedbackAnnotations = pgTable("feedback_annotations", {
  id: uuid().primaryKey(),
  feedbackRecordId: uuid("feedback_record_id").notNull().references(() => feedbackRecords.id),
  authorAccountId: uuid("author_account_id").notNull().references(() => accounts.id),
  kind: text().notNull(),
  body: text().notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});

export const triageBatches = pgTable("triage_batches", {
  id: uuid().primaryKey(),
  singletonKey: boolean("singleton_key").notNull().default(true),
  triggerKind: text("trigger_kind").notNull(),
  scheduledAt: time("scheduled_at").notNull(),
  settingsVersion: integer("settings_version").notNull(),
  runnerIdentity: text("runner_identity").notNull(),
  state: batchState().notNull().default("RUNNING"),
  startedAt: time("started_at").notNull().defaultNow(),
  finishedAt: time("finished_at"),
  recordsAttempted: integer("records_attempted").notNull().default(0),
  recordsCompleted: integer("records_completed").notNull().default(0),
  recordsNeedsAttention: integer("records_needs_attention").notNull().default(0),
  stopReason: text("stop_reason"),
  errorCode: text("error_code"),
});

export const feedbackLeases = pgTable("feedback_leases", {
  id: uuid().primaryKey(),
  singletonKey: boolean("singleton_key").notNull().default(true),
  batchId: uuid("batch_id").notNull().references(() => triageBatches.id),
  feedbackRecordId: uuid("feedback_record_id").notNull().references(() => feedbackRecords.id),
  attempt: integer().notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  leaseOwner: text("lease_owner").notNull(),
  acquiredAt: time("acquired_at").notNull().defaultNow(),
  heartbeatAt: time("heartbeat_at").notNull().defaultNow(),
  expiresAt: time("expires_at").notNull(),
  releasedAt: time("released_at"),
  result: text(),
  errorClassification: text("error_classification"),
});

export const feedbackUnits = pgTable("feedback_units", {
  id: uuid().primaryKey(),
  stableKey: text("stable_key").notNull().unique(),
  feedbackRecordId: uuid("feedback_record_id").notNull().references(() => feedbackRecords.id),
  ordinal: smallint().notNull(),
  title: text().notNull(),
  summary: text().notNull(),
  kindHint: text("kind_hint").notNull(),
  splitReason: text("split_reason"),
  state: unitState().notNull().default("RESEARCHING"),
  createdAt: time("created_at").notNull().defaultNow(),
  terminalAt: time("terminal_at"),
}, (table) => [uniqueIndex("feedback_units_record_ordinal").on(table.feedbackRecordId, table.ordinal)]);

export const researchCaptures = pgTable("research_captures", {
  id: uuid().primaryKey(),
  unitId: uuid("unit_id").notNull().references(() => feedbackUnits.id),
  kind: text().notNull(),
  sourceLocator: text("source_locator").notNull(),
  title: text().notNull(),
  publisher: text().notNull(),
  capturedRevision: text("captured_revision"),
  capturedAt: time("captured_at").notNull().defaultNow(),
  applicability: text().notNull(),
  facts: jsonb().notNull(),
  sanitizedExcerpt: text("sanitized_excerpt"),
  contentDigest: text("content_digest").notNull(),
  eligible: boolean().notNull().default(true),
  provenance: jsonb().notNull(),
}, (table) => [uniqueIndex("research_capture_unit_locator_kind").on(table.unitId, table.kind, table.sourceLocator)]);

export const eligibleIssueManifests = pgTable("eligible_issue_manifests", {
  id: uuid().primaryKey(),
  unitId: uuid("unit_id").notNull().unique().references(() => feedbackUnits.id),
  projectRevision: text("project_revision").notNull(),
  capturedAt: time("captured_at").notNull().defaultNow(),
  totalItemCount: integer("total_item_count").notNull(),
  nonDoneIssues: jsonb("non_done_issues").notNull(),
  doneHistoryIds: jsonb("done_history_ids").notNull(),
  openPullRequests: jsonb("open_pull_requests").notNull(),
  retrievalPolicyVersion: text("retrieval_policy_version").notNull(),
  rankedCandidates: jsonb("ranked_candidates").notNull(),
  manifestDigest: text("manifest_digest").notNull().unique(),
});

export const modelRuns = pgTable("model_runs", {
  id: uuid().primaryKey(),
  unitId: uuid("unit_id").notNull().references(() => feedbackUnits.id),
  provider: text().notNull(),
  modelIdentifier: text("model_identifier").notNull(),
  profileVersion: integer("profile_version").notNull(),
  promptVersion: text("prompt_version").notNull(),
  schemaVersion: text("schema_version").notNull(),
  evidenceManifestDigest: text("evidence_manifest_digest").notNull(),
  riskReviewReason: text("risk_review_reason"),
  startedAt: time("started_at").notNull(),
  finishedAt: time("finished_at"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  estimatedCostMicros: bigint("estimated_cost_micros", { mode: "number" }),
  responseId: text("response_id"),
  validationState: text("validation_state").notNull(),
  outputDigest: text("output_digest"),
});

export const triageDecisions = pgTable("triage_decisions", {
  id: uuid().primaryKey(),
  unitId: uuid("unit_id").notNull().references(() => feedbackUnits.id),
  version: integer().notNull().default(1),
  active: boolean().notNull().default(true),
  disposition: disposition().notNull(),
  confidence: numeric({ precision: 5, scale: 4 }).notNull(),
  reasonCode: text("reason_code").notNull(),
  rationale: text().notNull(),
  evidenceIds: jsonb("evidence_ids").notNull(),
  selectedIssueNodeId: text("selected_issue_node_id"),
  proposedPayload: jsonb("proposed_payload"),
  governedMetadata: jsonb("governed_metadata"),
  reviewRunIds: jsonb("review_run_ids").notNull(),
  state: decisionState().notNull().default("DRAFT"),
  createdAt: time("created_at").notNull().defaultNow(),
  terminalAt: time("terminal_at"),
}, (table) => [uniqueIndex("triage_decisions_unit_version").on(table.unitId, table.version)]);

export const githubOperations = pgTable("github_operations", {
  id: uuid().primaryKey(),
  decisionId: uuid("decision_id").notNull().references(() => triageDecisions.id),
  step: text().notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  targetDigest: text("target_digest").notNull(),
  payloadDigest: text("payload_digest").notNull(),
  preconditionSnapshot: jsonb("precondition_snapshot").notNull(),
  state: operationState().notNull().default("PENDING"),
  githubRequestId: text("github_request_id"),
  httpStatus: integer("http_status"),
  rateLimit: jsonb("rate_limit"),
  githubNodeId: text("github_node_id"),
  githubIssueNumber: integer("github_issue_number"),
  readbackDigest: text("readback_digest"),
  readbackPayload: jsonb("readback_payload"),
  readbackAt: time("readback_at"),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});

export const auditEvents = pgTable("audit_events", {
  id: uuid().primaryKey(),
  eventAt: time("event_at").notNull().defaultNow(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id"),
  action: text().notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  result: text().notNull(),
  reasonCode: text("reason_code"),
  correlationId: uuid("correlation_id").notNull(),
  operationId: uuid("operation_id"),
  safeMetadata: jsonb("safe_metadata").notNull(),
  previousEventHash: text("previous_event_hash"),
  eventHash: text("event_hash").notNull().unique(),
});
