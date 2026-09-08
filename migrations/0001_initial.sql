create extension if not exists citext;

do $$ begin create type account_role as enum ('USER', 'ADMIN', 'OWNER'); exception when duplicate_object then null; end $$;
do $$ begin create type account_status as enum ('PENDING', 'ACTIVE', 'SUSPENDED'); exception when duplicate_object then null; end $$;
do $$ begin create type feedback_state as enum ('QUEUED', 'LEASED', 'RESEARCHING', 'DECIDING', 'APPLYING', 'TRIAGED', 'NEEDS_ATTENTION', 'WITHDRAWN'); exception when duplicate_object then null; end $$;
do $$ begin create type batch_state as enum ('RUNNING', 'COMPLETED', 'STOPPED', 'FAILED'); exception when duplicate_object then null; end $$;
do $$ begin create type unit_state as enum ('RESEARCHING', 'DECIDING', 'VALIDATING', 'APPLYING', 'TERMINAL', 'NEEDS_ATTENTION'); exception when duplicate_object then null; end $$;
do $$ begin create type disposition as enum ('MERGED', 'CREATED', 'CONSIDERED'); exception when duplicate_object then null; end $$;
do $$ begin create type decision_state as enum ('DRAFT', 'SCHEMA_VALID', 'EVIDENCE_VALID', 'PRECONDITIONS_VALID', 'APPLYING', 'READBACK_CONFIRMED', 'TERMINAL', 'INVALID'); exception when duplicate_object then null; end $$;
do $$ begin create type operation_state as enum ('PENDING', 'SENT', 'CONFIRMED', 'RETRYABLE', 'FAILED'); exception when duplicate_object then null; end $$;

create table if not exists schema_migrations (
  version text primary key,
  digest text not null,
  applied_at timestamptz not null default now()
);

create table if not exists accounts (
  id uuid primary key,
  access_subject_hash text not null unique,
  email_normalized citext not null unique,
  display_name text not null check (char_length(display_name) between 1 and 120),
  role account_role not null default 'USER',
  status account_status not null default 'PENDING',
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  suspended_at timestamptz,
  last_seen_at timestamptz
);

create table if not exists application_settings (
  id uuid primary key,
  version integer not null unique check (version > 0),
  triage_paused boolean not null default false,
  triage_pause_reason text,
  observed_schedule text not null default '0 3 * * * America/Chicago',
  raw_retention_days integer not null default 180 check (raw_retention_days >= 180),
  model_profile_id uuid,
  risk_review_policy_version text not null,
  retrieval_limits jsonb not null default '{}'::jsonb,
  prompt_version text not null,
  schema_version text not null,
  effective_from timestamptz not null default now(),
  superseded_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists source_apps (
  id uuid primary key,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  display_name text not null check (char_length(display_name) between 1 and 80),
  enabled boolean not null default false,
  github_owner text not null,
  github_repo text not null,
  github_project_node_id text not null,
  github_project_number integer not null check (github_project_number > 0),
  github_installation_id bigint not null check (github_installation_id > 0),
  allowed_origins text[] not null check (cardinality(allowed_origins) > 0),
  return_url_prefixes text[] not null check (cardinality(return_url_prefixes) > 0),
  governed_labels text[] not null default array['type:bug','type:feature','type:maintenance','type:security','area:ui'] check (cardinality(governed_labels) >= 5),
  validation_status text not null default 'UNKNOWN' check (validation_status in ('VALID', 'INVALID', 'UNKNOWN')),
  validation_checked_at timestamptz,
  validation_digest text,
  paused_at timestamptz,
  pause_reason text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (github_owner, github_repo, github_project_node_id)
);

create table if not exists source_app_keys (
  id uuid primary key,
  source_app_id uuid not null references source_apps(id) on delete cascade,
  kid text not null,
  algorithm text not null default 'EdDSA' check (algorithm = 'EdDSA'),
  public_jwk jsonb not null,
  fingerprint text not null,
  not_before timestamptz not null,
  not_after timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source_app_id, kid),
  check (not_after > not_before)
);

create table if not exists model_profiles (
  id uuid primary key,
  provider text not null,
  model_identifier text not null,
  reasoning_effort text not null,
  max_input_tokens integer not null check (max_input_tokens > 0),
  max_output_tokens integer not null check (max_output_tokens > 0),
  timeout_ms integer not null check (timeout_ms between 1000 and 1800000),
  active boolean not null default false,
  secret_reference text not null,
  prompt_version text not null,
  prompt_digest text not null,
  schema_version text not null,
  schema_digest text not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table application_settings
  add constraint application_settings_model_profile_fk
  foreign key (model_profile_id) references model_profiles(id);

create table if not exists launch_nonces (
  id uuid primary key,
  source_app_id uuid not null references source_apps(id) on delete cascade,
  nonce_hash bytea not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  launch_session_id uuid,
  unique (source_app_id, nonce_hash),
  check (expires_at > issued_at),
  check (consumed_at is null or consumed_at >= issued_at)
);

create table if not exists launch_sessions (
  id uuid primary key,
  source_app_id uuid not null references source_apps(id),
  account_id uuid not null references accounts(id),
  environment text not null,
  route text not null,
  screen text not null,
  app_version text not null,
  source_revision text not null,
  return_url text not null,
  token_fingerprint text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > created_at)
);

alter table launch_nonces
  add constraint launch_nonces_session_fk
  foreign key (launch_session_id) references launch_sessions(id);

create sequence if not exists feedback_sequence;

create table if not exists feedback_records (
  id uuid primary key,
  sequence bigint not null unique default nextval('feedback_sequence'),
  submitter_account_id uuid not null references accounts(id),
  source_app_id uuid not null references source_apps(id),
  launch_session_id uuid not null unique references launch_sessions(id),
  environment text not null,
  route text not null,
  screen text not null,
  app_version text not null,
  source_revision text not null,
  state feedback_state not null default 'QUEUED',
  submitted_at timestamptz not null default now(),
  triage_terminal_at timestamptz,
  raw_delete_after timestamptz,
  raw_deleted_at timestamptz,
  withdrawn_at timestamptz,
  correlation_id uuid not null unique,
  check ((state = 'WITHDRAWN') = (withdrawn_at is not null)),
  check (raw_delete_after is null or triage_terminal_at is not null),
  check (raw_deleted_at is null or state in ('TRIAGED', 'NEEDS_ATTENTION', 'WITHDRAWN'))
);

create index if not exists feedback_records_queue_idx on feedback_records (state, sequence);
create index if not exists feedback_records_retention_idx on feedback_records (raw_delete_after) where raw_deleted_at is null and raw_delete_after is not null;

create table if not exists feedback_payloads (
  feedback_record_id uuid primary key references feedback_records(id) on delete cascade,
  feedback_text text not null check (char_length(feedback_text) between 1 and 20000),
  policy_version text not null,
  content_digest text not null,
  created_at timestamptz not null default now()
);

create table if not exists attachments (
  id uuid primary key,
  feedback_record_id uuid not null references feedback_records(id) on delete cascade,
  ordinal smallint not null check (ordinal between 1 and 5),
  display_name text not null check (char_length(display_name) between 1 and 255),
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  byte_size integer not null check (byte_size between 1 and 10485760),
  width integer not null check (width between 1 and 12000),
  height integer not null check (height between 1 and 12000),
  sha256 bytea not null,
  storage_key text not null unique check (storage_key !~ '(^|/)\.\.(/|$)' and storage_key !~ '^/'),
  decode_status text not null check (decode_status in ('VALIDATED', 'REJECTED')),
  scan_status text not null check (scan_status in ('CLEAN', 'UNAVAILABLE', 'REJECTED')),
  created_at timestamptz not null default now(),
  last_authorized_access_at timestamptz,
  deleted_at timestamptz,
  unique (feedback_record_id, ordinal),
  check ((width::bigint * height::bigint) <= 40000000)
);

create table if not exists feedback_annotations (
  id uuid primary key,
  feedback_record_id uuid not null references feedback_records(id),
  author_account_id uuid not null references accounts(id),
  kind text not null,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create table if not exists triage_batches (
  id uuid primary key,
  singleton_key boolean not null default true check (singleton_key),
  trigger_kind text not null check (trigger_kind in ('SCHEDULED', 'MANUAL')),
  scheduled_at timestamptz not null,
  settings_version integer not null,
  runner_identity text not null,
  state batch_state not null default 'RUNNING',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  records_attempted integer not null default 0,
  records_completed integer not null default 0,
  records_needs_attention integer not null default 0,
  stop_reason text,
  error_code text
);

create unique index if not exists one_running_triage_batch on triage_batches (singleton_key) where state = 'RUNNING';

create table if not exists feedback_leases (
  id uuid primary key,
  singleton_key boolean not null default true check (singleton_key),
  batch_id uuid not null references triage_batches(id),
  feedback_record_id uuid not null references feedback_records(id),
  attempt integer not null check (attempt > 0),
  idempotency_key text not null unique,
  lease_owner text not null,
  acquired_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz,
  result text,
  error_classification text,
  check (expires_at > acquired_at)
);

create unique index if not exists one_active_feedback_lease on feedback_leases (singleton_key) where released_at is null;
create unique index if not exists one_active_lease_per_record on feedback_leases (feedback_record_id) where released_at is null;

create table if not exists feedback_units (
  id uuid primary key,
  stable_key text not null unique,
  feedback_record_id uuid not null references feedback_records(id),
  ordinal smallint not null check (ordinal between 1 and 50),
  title text not null check (char_length(title) between 1 and 160),
  summary text not null check (char_length(summary) between 1 and 4000),
  kind_hint text not null check (kind_hint in ('BUG', 'FEATURE', 'MAINTENANCE', 'SECURITY', 'OTHER')),
  split_reason text,
  state unit_state not null default 'RESEARCHING',
  created_at timestamptz not null default now(),
  terminal_at timestamptz,
  unique (feedback_record_id, ordinal),
  check (ordinal = 1 or split_reason is not null),
  check ((state = 'TERMINAL') = (terminal_at is not null))
);

create table if not exists research_captures (
  id uuid primary key,
  unit_id uuid not null references feedback_units(id),
  kind text not null check (kind in ('PROJECT_SCHEMA', 'ISSUE', 'PULL_REQUEST', 'REPOSITORY', 'WEB', 'USER_EVIDENCE')),
  source_locator text not null,
  title text not null,
  publisher text not null,
  captured_revision text,
  captured_at timestamptz not null default now(),
  applicability text not null,
  facts jsonb not null default '{}'::jsonb,
  sanitized_excerpt text,
  content_digest text not null,
  eligible boolean not null default true,
  provenance jsonb not null default '{}'::jsonb
);

create unique index if not exists research_capture_unit_locator_kind
  on research_captures (unit_id, kind, source_locator);

create table if not exists eligible_issue_manifests (
  id uuid primary key,
  unit_id uuid not null unique references feedback_units(id),
  project_revision text not null,
  captured_at timestamptz not null default now(),
  total_item_count integer not null check (total_item_count >= 0),
  non_done_issues jsonb not null,
  done_history_ids jsonb not null,
  open_pull_requests jsonb not null,
  retrieval_policy_version text not null,
  ranked_candidates jsonb not null,
  manifest_digest text not null unique
);

create table if not exists model_runs (
  id uuid primary key,
  unit_id uuid not null references feedback_units(id),
  provider text not null,
  model_identifier text not null,
  profile_version integer not null,
  prompt_version text not null,
  schema_version text not null,
  evidence_manifest_digest text not null,
  risk_review_reason text,
  started_at timestamptz not null,
  finished_at timestamptz,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_micros bigint,
  response_id text,
  validation_state text not null,
  output_digest text
);

create table if not exists triage_decisions (
  id uuid primary key,
  unit_id uuid not null references feedback_units(id),
  version integer not null default 1,
  active boolean not null default true,
  disposition disposition not null,
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  reason_code text not null,
  rationale text not null check (char_length(rationale) between 1 and 6000),
  evidence_ids jsonb not null,
  selected_issue_node_id text,
  proposed_payload jsonb,
  governed_metadata jsonb,
  review_run_ids jsonb not null default '[]'::jsonb,
  state decision_state not null default 'DRAFT',
  created_at timestamptz not null default now(),
  terminal_at timestamptz,
  unique (unit_id, version),
  check ((disposition = 'MERGED') = (selected_issue_node_id is not null)),
  check (disposition = 'CONSIDERED' or proposed_payload is not null)
);

create unique index if not exists one_active_decision_per_unit on triage_decisions (unit_id) where active;

create table if not exists github_operations (
  id uuid primary key,
  decision_id uuid not null references triage_decisions(id),
  step text not null check (step in ('COMMENT', 'CREATE_ISSUE', 'ADD_PROJECT_ITEM', 'SET_FIELD', 'SET_LABELS', 'READBACK')),
  idempotency_key text not null unique,
  target_digest text not null,
  payload_digest text not null,
  precondition_snapshot jsonb not null,
  state operation_state not null default 'PENDING',
  github_request_id text,
  http_status integer,
  rate_limit jsonb,
  github_node_id text,
  github_issue_number integer,
  readback_digest text,
  readback_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state = 'CONFIRMED') = (readback_digest is not null and readback_at is not null))
);

create table if not exists audit_events (
  id uuid primary key,
  event_at timestamptz not null default now(),
  actor_type text not null,
  actor_id text,
  action text not null,
  target_type text not null,
  target_id text not null,
  result text not null,
  reason_code text,
  correlation_id uuid not null,
  operation_id uuid,
  safe_metadata jsonb not null default '{}'::jsonb,
  previous_event_hash text,
  event_hash text not null unique
);

create or replace function forbid_append_only_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'append-only table cannot be changed';
end;
$$;

drop trigger if exists audit_events_append_only_update on audit_events;
create trigger audit_events_append_only_update before update or delete on audit_events
for each row execute function forbid_append_only_mutation();

drop trigger if exists feedback_annotations_append_only_update on feedback_annotations;
create trigger feedback_annotations_append_only_update before update or delete on feedback_annotations
for each row execute function forbid_append_only_mutation();

insert into schema_migrations (version, digest)
values ('0001', 'pointview-initial-v1')
on conflict (version) do update set digest = excluded.digest;
