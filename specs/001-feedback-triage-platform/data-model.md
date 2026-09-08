# Data Model: PointView Feedback Triage Platform

**Database**: PostgreSQL 17 through Drizzle migrations
**Identifiers**: UUIDv7 application-generated identifiers
**Time**: `timestamptz` in UTC; display in the user's/browser's zone
**Integrity**: foreign keys, check constraints, partial unique indexes, immutable-row triggers where noted

## Conventions

- Raw user material is isolated in deletable payload tables. Stable provenance, derived decisions, and audit events never duplicate raw text or image bytes.
- Every mutable administrative row has `version`, `created_at`, `updated_at`, and optimistic-concurrency checks.
- Every external operation has a stable idempotency key and correlation ID.
- Secrets are referenced by external secret name/key; secret values are never stored in PostgreSQL.
- Enum values are database-constrained and mirrored by Zod schemas.

## Identity and configuration

### `accounts`

| Field | Type | Rules |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `access_subject_hash` | text | Unique keyed hash of verified Access subject; never expose |
| `email_normalized` | citext | Unique; Admin/Owner only |
| `display_name` | text | 1–120 characters |
| `role` | enum | `USER`, `ADMIN`, `OWNER` |
| `status` | enum | `PENDING`, `ACTIVE`, `SUSPENDED` |
| `version` | integer | Starts at 1; optimistic concurrency |
| lifecycle timestamps | timestamptz | Created, approved, suspended, last-seen |

Rules:

- A transaction-level advisory lock protects first-valid-login Owner creation.
- A deferred constraint/transactional service prevents demotion or suspension of the final active Owner.
- A Pending account has no feedback-data access beyond the pending page.

### `application_settings`

Versioned singleton snapshots. Fields include triage pause, observed deployment schedule metadata (read-only to the application), raw-retention days (default and minimum 180 for this release), selected model profile, risk-review policy version, retrieval limits, and schema/prompt versions. `effective_from` plus `superseded_at` preserve history. Changing the actual CronJob schedule remains a GitOps deployment change so the web application has no cluster mutation credential.

### `source_apps`

| Field | Type | Rules |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `slug` | text | Unique, immutable, URL-safe |
| `display_name` | text | 1–80 characters |
| `enabled` | boolean | Default false until validation succeeds |
| `github_owner` / `github_repo` | text | Immutable while records are queued; allowlisted installation target |
| `github_project_node_id` | text | Private Project V2 node ID |
| `github_project_number` | integer | Display/audit value |
| `github_installation_id` | bigint | Installation reference, not a token |
| `allowed_origins` | text[] | Exact HTTPS origins |
| `return_url_prefixes` | text[] | Exact normalized allowlist |
| `paused_at` / `pause_reason` | nullable | Owner-operated intake/triage control |
| `version` | integer | Optimistic concurrency |

Validation activation requires successful readback of repository identity, installation access, Project identity, fields/options, and labels.

### `source_app_keys`

Public verification keys only: `source_app_id`, `kid`, algorithm fixed to `EdDSA`, canonical JWK, `not_before`, `not_after`, `revoked_at`, and key fingerprint. Unique `(source_app_id, kid)`.

### `model_profiles`

Stores provider name, model identifier, reasoning setting, maximum input/output limits, timeout, active flag, and external secret reference. Prompts and JSON schemas are referenced by immutable version/digest. No provider key is stored.

## Launch and intake

### `launch_nonces`

| Field | Type | Rules |
| --- | --- | --- |
| `source_app_id` | uuid | Foreign key |
| `nonce_hash` | bytea | Keyed digest; unique with source app |
| `issued_at` / `expires_at` | timestamptz | Maximum five-minute lifetime by default |
| `consumed_at` | nullable timestamptz | Set once in verification transaction |
| `launch_session_id` | nullable uuid | Filled on consumption |

Expired rows may be removed after the security-audit window.

### `launch_sessions`

Short-lived server-side session: `id`, `source_app_id`, verified environment, route/screen, app version, source revision, validated return URL, authenticated account ID, token fingerprint, created/expiry/consumed timestamps. A launch session may create at most one feedback record.

### `feedback_records`

| Field | Type | Rules |
| --- | --- | --- |
| `id` | uuid | Primary key; public-safe opaque ID |
| `sequence` | bigint | Monotonic queue ordering |
| `submitter_account_id` | uuid | Foreign key; ownership boundary |
| `source_app_id` / `launch_session_id` | uuid | Required verified provenance |
| copied source context | structured columns | Environment, route/screen, app version, source revision; immutable |
| `state` | enum | See state machine below |
| `submitted_at` | timestamptz | Immutable |
| `triage_terminal_at` | nullable timestamptz | Set when all units terminal |
| `raw_delete_after` | nullable timestamptz | Terminal time + 180 days |
| `raw_deleted_at` | nullable timestamptz | Retention/withdrawal proof |
| `withdrawn_at` | nullable timestamptz | Only from `QUEUED`, never leased |
| `correlation_id` | uuid | Unique request/process correlation |

### `feedback_payloads`

One-to-one removable raw payload: `feedback_record_id`, normalized UTF-8 text (1–20,000 characters), consent/policy version, created timestamp, and content digest. Insert-only until audited retention or withdrawal deletion. Its absence must agree with `raw_deleted_at`.

### `attachments`

| Field | Type | Rules |
| --- | --- | --- |
| `id` | uuid | Generated object name; never original filename |
| `feedback_record_id` | uuid | Foreign key |
| `ordinal` | smallint | 1–5; unique per record |
| safe metadata | columns | Original display name after control-character removal, normalized MIME, byte size, width, height |
| `sha256` | bytea | Digest of normalized bytes |
| `storage_key` | text | Random relative key; no traversal components |
| `decode_status` / `scan_status` | enums | Explicit validation results |
| timestamps | timestamptz | Created, last authorized access, deleted |

Normalized bytes are stored outside the public web root. Deletion removes bytes first, verifies absence, then records `deleted_at`; retry is idempotent.

### `feedback_annotations`

Append-only Admin/Owner corrections or notes: `id`, `feedback_record_id`, `author_account_id`, `kind`, privacy-reviewed body, created timestamp. Original payload is never overwritten.

## Scheduling and processing

### `triage_batches`

One row per scheduled/manual run: `id`, trigger kind, scheduled timestamp, settings version, runner identity, state, started/finished timestamps, records attempted/completed/needs-attention, stop reason, and sanitized error code. A partial unique index allows only one `RUNNING` batch; a PostgreSQL advisory lock is also required.

### `feedback_leases`

Current/history lease rows: `id`, `batch_id`, `feedback_record_id`, `attempt`, stable idempotency key, lease owner, acquired/heartbeat/expiry/released timestamps, result, and error classification. Only one unexpired active lease exists per feedback record, and only one active lease exists globally.

### `feedback_units`

| Field | Type | Rules |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `feedback_record_id` | uuid | Parent lineage |
| `ordinal` | smallint | Deterministic order; unique per record |
| `title` | text | 1–160 characters, privacy reviewed |
| `summary` | text | Derived minimized concern, not raw copy |
| `kind_hint` | enum | Bug, feature, maintenance, security, other |
| `split_reason` | text | Required when record has multiple units |
| `state` | enum | `RESEARCHING`, `DECIDING`, `VALIDATING`, `APPLYING`, `TERMINAL`, `NEEDS_ATTENTION` |
| `created_at` / `terminal_at` | timestamptz | Lifecycle |

Units are inserted from one validated split manifest. Reprocessing reuses the manifest version and stable unit keys.

### `research_captures`

Normalized evidence only: `id`, unit ID, kind (`PROJECT_SCHEMA`, `ISSUE`, `PULL_REQUEST`, `REPOSITORY`, `WEB`, `USER_EVIDENCE`), source locator, title/publisher, captured revision/ETag, captured time, applicability, sanitized excerpt or structured facts, content digest, eligibility flags, and license/provenance metadata. Raw clone paths and credentials are forbidden.

### `eligible_issue_manifests`

Proves the all-status-except-Done screen: target Project revision/capture time, total item count, non-Done Issue node IDs/statuses/digests, Done history IDs consulted, open PR IDs, retrieval-policy version, ranked candidate IDs/scores, and manifest digest.

### `model_runs`

Records provider/model/profile, prompt/schema/evidence-manifest versions, risk-review reason, start/end, usage counts/cost estimate, response ID if allowed, validation state, and output digest. Raw chain-of-thought and raw provider output are not stored; only schema-valid decision material and sanitized diagnostics are retained. API calls use `store: false`.

### `triage_decisions`

Versioned decision: `id`, unit ID, disposition (`MERGED`, `CREATED`, `CONSIDERED`), confidence, reason code, rationale, evidence IDs, selected Issue ID if merged, proposed Issue/comment payload, governed metadata, review-run IDs, validation state, and terminal timestamp. Exactly one active validated decision exists per unit.

### `github_operations`

| Field | Type | Rules |
| --- | --- | --- |
| `id` | uuid | Also embedded in HTML marker |
| `decision_id` | uuid | One decision may have ordered steps |
| `step` | enum | Comment, create Issue, add Project item, set field, set labels, readback |
| `idempotency_key` | text | Unique |
| intended target/payload digest | columns | No token or raw feedback |
| precondition snapshot | jsonb | Refreshed Issue/Project state digest |
| state | enum | `PENDING`, `SENT`, `CONFIRMED`, `RETRYABLE`, `FAILED` |
| GitHub response metadata | columns | Request ID, status, rate-limit values, node/Issue IDs |
| readback digest/time | columns | Required before confirmation |

### `audit_events`

Append-only sanitized event ledger: `id`, event time, actor type/ID, action, target type/ID, result, reason code, correlation ID, operation ID, source IP prefix hash if required for security (never raw by default), structured safe metadata, previous-event hash, and event hash. No raw feedback, screenshot bytes, tokens, assertions, provider output, or secrets.

## State transitions

### Feedback record

```text
QUEUED -> LEASED -> RESEARCHING -> DECIDING -> APPLYING -> TRIAGED
   |         |           |             |           |
   |         +-----------+-------------+-----------+-> NEEDS_ATTENTION
   +-> WITHDRAWN

Expired LEASED/RESEARCHING/DECIDING/APPLYING -> QUEUED (retry available)
Expired state with exhausted retry budget     -> NEEDS_ATTENTION
```

Rules:

- `WITHDRAWN` is legal only from `QUEUED` when no active lease exists.
- `TRIAGED` requires at least one unit and every unit `TERMINAL` with exactly one validated decision.
- `NEEDS_ATTENTION` is terminal for the current automated attempt but may be requeued by an audited Admin action after its cause is corrected.
- A failed record does not block leasing the next eligible record unless the failure is classified as a global integration failure.

### Triage decision

```text
DRAFT -> SCHEMA_VALID -> EVIDENCE_VALID -> PRECONDITIONS_VALID
      -> APPLYING -> READBACK_CONFIRMED -> TERMINAL
```

- `CONSIDERED` skips `APPLYING` and becomes terminal only after evidence validation.
- Any target drift invalidates `PRECONDITIONS_VALID` and returns the unit to deterministic refresh/redecision.
- `MERGED` is invalid if the refreshed target Issue is Done or not in the registered Project.

## Retention behavior

1. When all units are terminal, set `triage_terminal_at` and `raw_delete_after = triage_terminal_at + interval '180 days'`.
2. The retention job selects eligible records in bounded batches with `SKIP LOCKED`.
3. Delete normalized attachment objects and verify absence.
4. Delete `attachments` sensitive display metadata and `feedback_payloads`; keep stable IDs, digests, deletion timestamps, and minimized lineage.
5. Emit hash-linked audit events containing counts and outcome, not deleted content.
6. Withdrawal follows the same byte/payload deletion path immediately and preserves only a content-free tombstone.

## Required indexes and constraints

- `feedback_records(state, sequence)` for oldest-first leasing.
- Partial unique index ensuring one globally active lease.
- Partial unique index ensuring one running triage batch.
- Unique source nonce digest and launch-session-to-feedback relationship.
- Unique unit ordinal per record and one active decision per unit.
- Unique GitHub operation idempotency key and operation marker.
- GIN text-search index over privacy-minimized Issue cache, not raw feedback.
- Retention index on `(raw_delete_after)` where raw material is present.
- Check constraints for upload counts/sizes/dimensions, confidence range, and valid state/timestamp combinations.
