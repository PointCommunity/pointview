---
description: "Dependency-aware implementation tasks for PointView"
---

# Tasks: PointView Feedback Triage Platform

**Input**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, and `quickstart.md` in this directory
**Rule**: Start only after human plan/Issue approval. Write focused tests first and observe the intended failure before implementation. Every completed task must leave the repository buildable.

## Format

Each checkbox follows `[TaskID] [P?] [Story?] Description — Acceptance; Verification; Dependencies` and names the likely files. `[P]` means the task can run independently after its dependencies, not that agent delegation is required.

## Phase 1 — Governed repository bootstrap

- [x] **T001** Create the private `PointCommunity/pointview` repository and configure `main`, Issues, security settings, ruleset, and least-default Actions permissions with `gh`; record readback in `docs/development-pipeline-policy.html` — **Acceptance**: private identity/settings match the approved plan and unavailable provider controls are explicitly recorded; **Verify**: `gh repo view` and API readback (GitHub returned HTTP 403 for private-repository rulesets/branch protection on the current plan); **Depends**: plan and exact Issue approval.
- [x] **T002** Copy PointGuide Project structure without items, rename it `PointView`, link the new repository, and reproduce Status/Priority/Impact/Effort values — **Acceptance**: private Project fields/options and repository link exactly match `plan.md`; **Verify**: `gh project field-list`, `gh project view`, GraphQL readback plus fixture-backed `scripts/audit-github-project.mjs`; **Depends**: T001; **Files**: `scripts/audit-github-project.mjs`.
- [x] **T003** [P] Adapt PointGuide `AGENTS.md`, `.claude/`, `CLAUDE.md`, `GEMINI.md`, and `.agents/skills/**` into PointView — **Acceptance**: all lifecycle/shared skills are present, PointView-specific, omit knowledge/training, and preserve PM-only development activation; **Verify**: `node scripts/audit-agent-skills.mjs`; **Depends**: T001; **Files**: `AGENTS.md`, `.agents/skills/**`, `.claude/**`, `CLAUDE.md`, `GEMINI.md`.
- [x] **T004** [P] Adapt labels, CI-alignment scripts, Project audit, and HTML pipeline policy — **Acceptance**: governed labels/fields/gates are deterministic and the policy is accessible dark-mode HTML; **Verify**: script fixtures and HTML validation; **Depends**: T001; **Files**: `scripts/audit-*.mjs`, `docs/development-pipeline-policy.html`, `.github/workflows/ci.yml`.
- [x] **T005** Make the one-time governance/spec scaffold commit on `main`, create the exact approved Issue #1 from `specs/001-feedback-triage-platform/issue-draft.html`, add/read back Backlog metadata, then create `issue/1-feedback-triage-platform` — **Acceptance**: bootstrap tree SHA is recorded, Issue is open/unassigned/in Project, and branch starts at that SHA; **Verify**: bootstrap commit `44a9bafb0979ff6eec5c7d2c408c9941d3e21f82`, exact Issue/Project readback, and branch ancestry; **Depends**: T002–T004; **Files**: `specs/001-feedback-triage-platform/issue-draft.html`.

**Checkpoint A**: Repository, Project, Issue #1, and branch governance are exact and auditable before application code begins.

## Phase 2 — Foundational application skeleton

- [x] **T006** Initialize the npm workspace, pinned dependencies, scripts, formatting, lint, TypeScript, Vitest coverage, Playwright, and Next.js app shell — **Acceptance**: clean install is reproducible and empty app passes lint/typecheck/test/build; **Verify**: `npm ci && npm run lint && npm run typecheck && npm test && npm run build`; **Depends**: T005; **Files**: `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `src/app/**`.
- [x] **T007** [P] Implement typed environment parsing, server-only boundaries, Problem Details errors, correlation IDs, security headers, CSP, deployment-edge/application rate-limit policy, and sanitized logging — **Acceptance**: missing/invalid configuration fails closed, abuse-sensitive routes return `429`/`Retry-After` under test limits without cross-account starvation, and secrets/raw content never log; **Verify**: unit/security/rate-limit tests; **Depends**: T006; **Files**: `src/server/config/**`, `src/server/http/**`, `src/server/audit/logger.ts`, `next.config.ts`, `tests/security/logging.test.ts`, `tests/security/rate-limits.test.ts`.
- [x] **T008** Define Drizzle schema and reversible initial migrations for identity, settings, source apps, intake, leases, units, evidence, model runs, GitHub operations, and audit events — **Acceptance**: all `data-model.md` constraints/indexes exist, including one active lease/batch and deletable raw payload separation; **Verify**: migration up/down/re-up and second-active-lease rejection passed against isolated PostgreSQL 17.11; **Depends**: T006; **Files**: `src/server/db/schema/**`, `migrations/**`, `tests/integration/migrations.test.ts`.
- [x] **T009** Implement transaction helpers, optimistic concurrency, UUIDv7 IDs, advisory-lock helpers, and fixture factories — **Acceptance**: retry-safe transactions and lock behavior have deterministic tests; **Verify**: UUID/version unit tests and PostgreSQL concurrent first-login advisory-lock suite; **Depends**: T008; **Files**: `src/server/db/**`, `tests/helpers/**`, `tests/integration/accounts.test.ts`.
- [x] **T010** Implement Cloudflare Access verification, PointView sessions, first-Owner transaction, account lifecycle, final-Owner protection, and resource policy helpers — **Acceptance**: the initial Owner can establish an administration session before any source app exists; forged/direct headers, cross-origin bootstrap, non-Owner bootstrap, pending users, role escalation, cross-user access, and final-Owner removal fail closed; **Verify**: bootstrap route, JWT/session/policy, PostgreSQL concurrent first-Owner, and final-Owner tests; **Depends**: T007–T009; **Files**: `src/app/bootstrap/route.ts`, `src/server/auth/**`, `src/server/accounts/**`, `tests/contract/bootstrap-route.test.ts`, `tests/security/auth.test.ts`, `tests/integration/accounts.test.ts`.
- [x] **T011** Implement append-only hash-linked audit events and safe audit query policies — **Acceptance**: required event types record correlation/operation IDs without prohibited data and tampering is detectable; **Verify**: recursive metadata, chain-tamper, persisted event, and PostgreSQL mutation-rejection tests; **Depends**: T007–T010; **Files**: `src/server/audit/**`, `tests/security/audit.test.ts`, `tests/integration/accounts.test.ts`.
- [x] **T012** [P] Build the dark-mode-first design tokens, semantic components, responsive shell, focus/error/status patterns, and reduced-motion behavior — **Acceptance**: shell works at 320 px and 200% zoom with 44 px targets and keyboard navigation; **Verify**: Playwright/axe passed at 320, 768, and 1280 px with keyboard skip-link coverage; **Depends**: T006; **Files**: `src/styles/**`, `src/components/**`, `src/app/layout.tsx`, `e2e/shell.spec.ts`.

**Checkpoint B**: Foundation passes full local gates; auth/data/audit/UI primitives are independently verified before product stories.

## Phase 3 — User Story 1: trusted contextual feedback

**Goal**: An approved User can arrive from a registered app and submit private feedback/screenshots without choosing routing metadata.

- [x] **T013** [P] [US1] Implement and test the framework-neutral EdDSA launch SDK and auto-POST form helper — **Acceptance**: canonical v1 claims are signed server-side and private keys never enter rendered HTML; **Verify**: package unit/interop tests against `contracts/launch-context.schema.json`; **Depends**: T006; **Files**: `packages/launch-sdk/src/**`, `packages/launch-sdk/tests/**`, `packages/launch-sdk/package.json`.
- [x] **T014** [US1] Implement Owner source-app registration/versioning/key rotation and deterministic GitHub repository/Project/label validation — **Acceptance**: registration remains disabled until exact live readback succeeds and no secret is stored; **Verify**: contract/integration tests with GitHub fixtures and PostgreSQL version/activation tests; **Depends**: T009–T011; **Files**: `src/server/source-apps/**`, `src/app/api/admin/source-apps/**`, `tests/contract/source-apps.test.ts`, `tests/contract/source-app-github-validation.test.ts`, `tests/integration/source-app-service.test.ts`.
- [x] **T015** [US1] Implement launch JWS verification, origin/return allowlists, single-use nonce consumption, account binding, session cookie, and clean redirect — **Acceptance**: valid launch succeeds once; replay/expiry/wrong audience/key/source/origin/return URL fail without a record; **Verify**: security and route contract tests plus PostgreSQL atomic-consumption test; **Depends**: T010, T013–T014; **Files**: `src/server/launch/**`, `src/app/launch/route.ts`, `tests/security/launch.test.ts`, `tests/contract/launch-route.test.ts`, `tests/integration/feedback-intake.test.ts`.
- [x] **T016** [P] [US1] Implement private attachment storage adapter and transactional staging/compensation — **Acceptance**: generated relative keys cannot traverse, partial failures leave no orphaned byte/object association, and retrieval is private; **Verify**: storage unit/integration tests; **Depends**: T008–T009; **Files**: `src/server/storage/**`, `tests/integration/storage.test.ts`.
- [x] **T017** [US1] Implement image allowlist, decoded filename/MIME/magic/dimension/pixel checks, Sharp normalization/metadata stripping, size/count limits, and scan interface — **Acceptance**: all valid formats normalize and polyglot/malformed/bomb/active/oversize fixtures fail closed; **Verify**: upload/security tests cover allowed normalization, metadata removal, magic/MIME mismatch, unsupported active content, and count limits; **Depends**: T016; **Files**: `src/server/feedback/images.ts`, `src/server/feedback/scanner.ts`, `tests/security/uploads.test.ts`.
- [x] **T018** [US1] Implement atomic feedback creation and own-record/attachment query policies from the OpenAPI contract — **Acceptance**: one consumed launch creates one immutable queued record with provenance/payload/attachments and users cannot access others' records; **Verify**: API contract/PostgreSQL integration tests including storage compensation; **Depends**: T015–T017; **Files**: `src/server/feedback/**`, `src/app/api/feedback/**`, `tests/contract/feedback.test.ts`, `tests/integration/feedback-intake.test.ts`.
- [x] **T019** [US1] Build verified-context submission, upload progress/errors, acknowledgement, own-history/detail, and privacy/retention UI — **Acceptance**: no product metadata selection exists, context is read-only, statuses are understandable, and raw-retention notice is explicit; **Verify**: Playwright happy/error paths at target viewports and axe; **Depends**: T012, T018; **Files**: `src/app/(authenticated)/feedback/**`, `src/components/feedback/**`, `e2e/feedback-submit.spec.ts`.
- [x] **T020** [US1] Implement queued/unleased withdrawal and immediate audited raw deletion — **Acceptance**: owner can withdraw only their own queued/unleased record; bytes/payload disappear and content-free tombstone remains; **Verify**: race/cross-user/idempotent deletion tests plus browser flow; **Depends**: T018–T019; **Files**: `src/server/feedback/withdraw.ts`, `src/app/api/feedback/[feedbackId]/route.ts`, `e2e/feedback-withdraw.spec.ts`.

**Independent US1 test**: Register a fixture source, launch with a signed assertion, submit text plus normalized image, inspect the owned record, reject forged/cross-user access, and withdraw a second queued record.

## Phase 4 — User Story 2: daily sequential research and decisions

**Goal**: One daily batch processes oldest-first, exactly one record at a time, until empty and produces evidence-valid unit decisions.

- [x] **T021** [US2] Implement batch singleton/advisory lock, oldest-first `SKIP LOCKED` lease, heartbeat, recovery, retries, pause checks, and drain loop — **Acceptance**: one global lease exists, concurrent runners do no work, expired leases recover, local exhaustion isolates to Needs Attention, and safe later records continue; **Verify**: sequential/failure-isolation tests and isolated PostgreSQL 17.11 oldest-first/global-lease test; **Depends**: T009, T011, T018; **Files**: `src/server/triage/batch.ts`, `src/server/triage/postgres-queue.ts`, `tests/integration/triage-leases.test.ts`, `tests/integration/postgres-triage-leases.test.ts`.
- [x] **T022** [P] [US2] Implement GitHub App JWT/installation-token client, in-memory expiry cache, rate-limit classification, pagination, and repository allowlist — **Acceptance**: tokens never persist/log, requests cannot leave registered targets, and Retry-After/backoff metadata is honored; **Verify**: signed-auth/API fixture tests; **Depends**: T007, T014; **Files**: `src/server/github/client.ts`, `tests/contract/github-auth.test.ts`.
- [x] **T023** [US2] Implement Project schema/item/Issue/Done-history/open-PR collectors with full pagination and immutable snapshot digests — **Acceptance**: every Project Issue is classified by current Status and all non-Done IDs enter the eligibility manifest; **Verify**: multi-page/redacted/missing-Status/drift fixture tests; **Depends**: T022; **Files**: `src/server/github/project-reader.ts`, `src/server/research/manifest.ts`, `tests/contract/project-reader.test.ts`.
- [x] **T024** [US2] Implement ephemeral read-only repository checkout and deterministic code/docs/tests/history extraction with token redaction and cleanup — **Acceptance**: checkout credentials use askpass/in-memory environment, no credential reaches remote URL/log/evidence, path/size limits apply, and temp data is deleted; **Verify**: local Git fixture/security tests including shell-shaped query and credential redaction; **Depends**: T022; **Files**: `src/server/research/repository.ts`, `tests/security/repository-research.test.ts`.
- [x] **T025** [US2] Implement inspect-all eligible manifest, exact/lexical candidate ranking, per-source batch cache, and bounded evidence packet builder — **Acceptance**: the manifest proves all non-Done IDs were screened, exact/active matches are retained, packets obey limits, and cache invalidation is deterministic; **Verify**: ranking/cache/bounds/redaction fixture tests; **Depends**: T023–T024; **Files**: `src/server/research/manifest.ts`, `src/server/research/batch-cache.ts`, `src/server/research/packet.ts`, `tests/unit/research-ranking.test.ts`, `tests/unit/research-packet.test.ts`.
- [x] **T026** [P] [US2] Implement provider-neutral model interface, OpenAI Responses adapter with `store:false`, strict schema, hosted web search/source capture, usage accounting, timeouts, and fixture transport — **Acceptance**: model receives no credentials or mutation tools, output parses only through the versioned schema, and normal tests make no live call; **Verify**: transport/contract/timeout tests against `triage-decision.schema.json` plus idempotent PostgreSQL source capture; **Depends**: T007; **Files**: `src/server/triage/model/**`, `src/server/research/web-captures.ts`, `tests/contract/model-adapter.test.ts`, `tests/integration/feedback-intake.test.ts`.
- [x] **T027** [US2] Implement decision validation for split lineage, evidence IDs, captured web-source URLs, registered routing, non-Done eligibility, disposition/mutation pairing, privacy, governed labels/fields, and confidence/risk policy — **Acceptance**: malformed/unsupported/injected/cross-repo/uncited outputs fail closed with reason codes; **Verify**: schema/property/adversarial fixtures; **Depends**: T025–T026; **Files**: `src/server/triage/decision-schema.ts`, `src/server/triage/decision-validator.ts`, `src/server/triage/model/web-sources.ts`, `tests/security/model-output.test.ts`.
- [x] **T028** [US2] Implement one-call default orchestration and bounded independent risk review for new/security/privacy/low-confidence/conflicting/active/mixed cases — **Acceptance**: risk triggers are deterministic, reviews cannot broaden target authority, disagreements resolve to Considered/Needs Attention rather than unsafe writes, and cost is recorded; **Verify**: orchestration matrix tests; **Depends**: T027; **Files**: `src/server/triage/orchestrator.ts`, `src/server/triage/risk-review.ts`, `tests/unit/triage-orchestrator.test.ts`.
- [x] **T029** [US2] Integrate research/decision stages into the sequential drain and terminal record/unit state transitions — **Acceptance**: each record yields stable unit keys and exactly one terminal disposition per unit before the next lease; **Verify**: duplicate/novel/mixed/insufficient/injection/provider-failure end-to-end fixtures; **Depends**: T021, T025, T028; **Files**: `src/server/triage/process-record.ts`, `tests/integration/triage-decisions.test.ts`.

**Independent US2 test**: With GitHub writes replaced by a recording adapter, one batch drains a mixed queue sequentially, proves all eligible Issues were screened, validates evidence, isolates record-specific failure, and makes no call on an empty rerun.

## Phase 5 — User Story 3: traceable GitHub outcomes

**Goal**: Validated decisions make the smallest idempotent GitHub change—or none—without changing development status.

- [x] **T030** [US3] Implement privacy-minimized HTML merge comment rendering with stable operation marker and protected PointView link — **Acceptance**: renderer escapes untrusted data, includes evidence/feedback count without identity/raw content, and targets exactly one Issue; **Verify**: HTML/privacy renderer fixtures; **Depends**: T027; **Files**: `src/server/github/render-merge.ts`, `tests/unit/render-issue.test.ts`.
- [x] **T031** [US3] Implement governed HTML new-Issue rendering and deterministic label/field mapping — **Acceptance**: required sections, one type, areas, Priority/Impact/Effort, Backlog, unassigned state, and operation marker validate; **Verify**: renderer and GitHub application mapping tests; **Depends**: T027; **Files**: `src/server/github/render-issue.ts`, `src/server/github/apply-decision.ts`, `tests/unit/render-issue.test.ts`.
- [x] **T032** [US3] Implement pre-write target/Project refresh, drift detection, and operation-ledger state machine — **Acceptance**: Done/missing/moved/schema-changed targets invalidate the write and every attempt has one idempotency key; **Verify**: drift and lost-response tests; **Depends**: T022–T023, T030–T031; **Files**: `src/server/github/preconditions.ts`, `src/server/github/operations.ts`, `tests/integration/github-preconditions.test.ts`.
- [x] **T033** [US3] Implement MERGED comment apply/search/readback without metadata or Status mutation — **Acceptance**: retry finds its existing marker and confirms exact content once; **Verify**: isolated repo/fixture tests including network-loss replay; **Depends**: T032; **Files**: `src/server/github/apply-decision.ts`, `tests/contract/github-operations.test.ts`.
- [x] **T034** [US3] Implement CREATED Issue/labels/Project-add/field-update/readback as ordered resumable steps — **Acceptance**: partial retries resume without duplicates, final Issue is open/unassigned/Backlog with exact metadata, and no development action occurs; **Verify**: isolated Project test plus each-step fault injection; **Depends**: T032; **Files**: `src/server/github/apply-decision.ts`, `tests/contract/github-operations.test.ts`.
- [x] **T035** [US3] Implement CONSIDERED terminalization with reason/confidence/evidence/revisit fields and zero mutation-client calls — **Acceptance**: durable operation-ledger proof exists and recording adapter sees no write; **Verify**: `tests/contract/github-operations.test.ts`; **Depends**: T027; **Files**: `src/server/github/apply-decision.ts`, `tests/contract/github-operations.test.ts`.
- [x] **T036** [US3] Integrate all disposition appliers into the batch with rate/abuse-limit delay, retry, readback, and development-action denylist — **Acceptance**: every unit terminates only after proof, and tests prove no status/branch/PR/release/close/Done operation is reachable; **Verify**: full GitHub adapter matrix and batch integration; **Depends**: T029, T033–T035; **Files**: `src/server/github/outcome-applier.ts`, `src/server/triage/process-record.ts`, `tests/security/triage-authority.test.ts`.

**Independent US3 test**: Apply merge/create/consider fixtures twice against an isolated Project; observe exactly one intended mutation, complete readback, unchanged existing-Issue statuses, and no development workflow activity.

## Phase 6 — User Story 4: operations, controls, and retention

**Goal**: Authorized operators can understand/control the system, recover isolated failures, and enforce raw-data deletion.

- [x] **T037** [P] [US4] Implement account administration APIs/UI with optimistic concurrency and Owner-only Owner membership — **Acceptance**: role matrix/final-Owner invariants hold in API and UI; **Verify**: contract/browser/security tests; **Depends**: T010, T012; **Files**: `src/app/api/admin/accounts/**`, `src/app/(authenticated)/admin/accounts/**`, `e2e/admin-accounts.spec.ts`.
- [x] **T038** [US4] Implement source-app/key/integration administration UI with validation readback and version history — **Acceptance**: secrets are never displayed, invalid targets cannot enable, pause is immediate, and audit history is visible; **Verify**: browser/fixture tests; **Depends**: T014, T037; **Files**: `src/app/(authenticated)/admin/source-apps/**`, `src/components/admin/source-apps/**`, `e2e/admin-source-apps.spec.ts`.
- [x] **T039** [P] [US4] Implement versioned model/prompt/risk/retention settings with external secret references and triage pause — **Acceptance**: Owner-only updates use If-Match, raw retention cannot fall below 180 days, and secret values never enter responses/logs; **Verify**: contract/security tests; **Depends**: T010–T011; **Files**: `src/server/config/settings.ts`, `src/app/api/admin/settings/**`, `tests/contract/settings.test.ts`.
- [x] **T040** [US4] Build record/evidence/decision/operation detail views, append-only correction/operational annotations, role-based redaction, and safe image preview — **Acceptance**: Users receive sanitized own status; Admin/Owner see auditable evidence/readback and may append notes without altering raw content, but never receive credentials/raw model output; **Verify**: resource-matrix and immutability browser/API tests; **Depends**: T019, T029, T036–T039; **Files**: `src/app/(authenticated)/feedback/[feedbackId]/**`, `src/app/api/admin/feedback/[feedbackId]/annotations/route.ts`, `src/components/triage/**`, `e2e/triage-detail.spec.ts`.
- [x] **T041** [US4] Build queue/batch health, usage/cost, rate-limit, Needs Attention, and last-successful-cycle views — **Acceptance**: required operational metrics and precise safe failure reasons are visible and stale/running state is distinguishable; **Verify**: seeded browser/contract tests; **Depends**: T021, T029, T036; **Files**: `src/server/operations/**`, `src/app/(authenticated)/admin/operations/**`, `src/app/api/admin/triage-batches/**`, `e2e/operations.spec.ts`.
- [x] **T042** [US4] Implement audited Admin requeue after corrective action while preserving original sequence — **Acceptance**: only Needs Attention records requeue, explanation is required, active duplicate lease is impossible, and order remains stable; **Verify**: API/race tests; **Depends**: T021, T041; **Files**: `src/server/triage/requeue.ts`, `src/app/api/admin/feedback/[feedbackId]/requeue/route.ts`, `tests/integration/requeue.test.ts`.
- [x] **T043** [US4] Implement 180-day retention selection, attachment-byte verification/deletion, payload deletion, tombstone preservation, retries, and metrics — **Acceptance**: only eligible terminal raw data is erased, derived/audit records remain, and rerun is idempotent; **Verify**: fake-clock/object-failure integration tests; **Depends**: T016, T020, T029; **Files**: `src/server/retention/**`, `src/cli/retention-once.ts`, `tests/integration/retention.test.ts`.
- [x] **T044** [US4] Implement minimal liveness, aggregate readiness, Prometheus metrics, and alert/runbook hooks — **Acceptance**: readiness checks migrations/storage/source registry/GitHub configuration without model work or secret detail; **Verify**: dependency-failure matrix; **Depends**: T036, T043; **Files**: `src/app/api/health/route.ts`, `src/app/api/ready/route.ts`, `src/server/operations/metrics.ts`, `tests/integration/readiness.test.ts`.

**Independent US4 test**: Exercise User/Admin/Owner matrices, pause/requeue a record, inspect decision proof, and run retention against expired terminal data while observing safe metrics/audit output.

## Phase 7 — User Story 5: governed delivery and release

**Goal**: PointView is deployable to isolated Canary and Production through the adopted exact-candidate pipeline.

- [x] **T045** [P] [US5] Create reproducible non-root multi-stage AMD64 container, entrypoints, probes, filesystem permissions, SBOM, and image scan rules — **Acceptance**: runtime is read-only except declared temp/attachment paths and no build secret/layer leak exists; **Verify**: local Podman build/inspect/run, Trivy/SBOM; **Depends**: T044; **Files**: `Dockerfile`, `.dockerignore`, `scripts/container-entrypoint.sh`, `.github/workflows/ci.yml`.
- [x] **T046** [P] [US5] Create dark-mode accessible HTML architecture, source integration, operations, and privacy/retention documents — **Acceptance**: documents match contracts/runbooks, contain no secrets, render responsively, and have navigable headings/links; **Verify**: HTML validation, link check, Playwright/axe; **Depends**: T036, T043–T044; **Files**: `docs/architecture.html`, `docs/source-app-integration.html`, `docs/operations.html`, `docs/privacy-and-retention.html`.
- [x] **T047** [US5] Complete CI with unit/integration/contract/security/accessibility/browser/build/coverage/audit/migration/container gates and no deployment on PR — **Acceptance**: required checks map to `AGENTS.md`, fail on planted fixture violations, and protect `main`; **Verify**: local parity plus GitHub Actions run; **Depends**: T003–T006, T045–T046; **Files**: `.github/workflows/ci.yml`, `scripts/audit-ci-alignment.mjs`.
- [ ] **T048** [US5] Add PointView Canary GitOps app with isolated PostgreSQL RWO volume, attachments RWX volume, web deployment, triage/retention CronJobs, 1Password secrets, Access route, and immutable digest value — **Acceptance**: rendered manifests match current homelab chart/rules, triage uses `Forbid`/timezone, and no Production resource is shared; **Verify**: homelab app validation/render/diff; **Depends**: T045, full homelab instruction reread; **Files**: `/Users/chris/Documents/Github/homelab/apps/pointview-canary/Chart.yaml`, `/Users/chris/Documents/Github/homelab/apps/pointview-canary/values.yaml`.
- [ ] **T049** [US5] Add matching isolated Production GitOps app with promotion-only digest field and rollback-safe migration policy — **Acceptance**: Production has separate URL/data/storage/secrets and can receive the exact Canary digest without rebuild; **Verify**: homelab render/diff and isolation audit; **Depends**: T048; **Files**: `/Users/chris/Documents/Github/homelab/apps/pointview/Chart.yaml`, `/Users/chris/Documents/Github/homelab/apps/pointview/values.yaml`.
- [ ] **T050** [US5] Add deterministic live verification for asset/source identity, health/readiness, auth redirects, role-safe APIs, storage, CronJob ownership/history, digest, and whole-cluster health — **Acceptance**: script distinguishes Canary/Production and fails on stale/wrong/shared resources; **Verify**: controlled fixture then Canary execution; **Depends**: T048–T049; **Files**: `scripts/verify-live.mjs`, `.agents/skills/pointview-release-canary/**`, `.agents/skills/pointview-release-production/**`.
- [ ] **T051** [US5] Run full local/CI gates, commit/push exact Issue branch, create `Refs #1` PR, and prove PR head/tree equals the tested tree — **Acceptance**: clean candidate identity and all required checks are green; **Verify**: git/gh readback and retained command evidence; **Depends**: T047–T050.
- [ ] **T052** [US5] Build/push one immutable candidate image, deploy its digest to Canary through Gitea/Argo, run live/UI/Job/failure-recovery verification, and move Issue #1 to In Review — **Acceptance**: exact source/tree/image/digest/GitOps chain is proven and user can test Canary; **Verify**: Zot manifest, Argo/Kubernetes, endpoint/browser, Project readbacks; **Depends**: T051.
**Independent US5 test**: Complete the exact-candidate chain on Canary; Production is a separate approval-gated continuation using the same digest after the final audit.

## Phase 8 — Cross-cutting final audit

- [ ] **T053** Run the complete quickstart, requirements-to-test traceability, OpenAPI/JSON-schema checks, dependency/security/secret scans, 80% coverage gate, browser matrix, and planted-failure audits — **Acceptance**: every FR/SC maps to passing evidence or an explicit blocked item; **Verify**: `quickstart.md` command record and traceability report; **Depends**: T001–T052; **Files**: `specs/001-feedback-triage-platform/quickstart.md`, `docs/architecture.html`, test reports.
- [ ] **T054** Review privacy deletion, prompt-injection, GitHub authority, long-running drainage, migration/rollback, and disaster-recovery evidence with the human before Production — **Acceptance**: residual risks and operator responsibilities are explicit; **Verify**: signed review record in Issue #1/PR without raw sensitive data; **Depends**: T053.

## Phase 9 — Separately approved Production promotion

- [ ] **T055** [US5] After the separate exact Production approval, revalidate candidate identity, merge, promote the same digest, verify Production and whole homelab, clean only proven-unreferenced PointView manifests, close Issue #1, and set Done — **Acceptance**: no rebuild occurred, rollback remains viable, cluster is healthy, and Project/Issue/registry state is exact; **Verify**: git/gh/Zot/Gitea/Argo/Kubernetes/browser/API readbacks; **Depends**: T054 and exact phrase `Approved to merge and deploy production`.

## Dependency graph

```text
Approval -> Repository/Project bootstrap (T001-T005)
         -> Foundation (T006-T012)
         -> Trusted intake (T013-T020)
         -> Sequential research/decision (T021-T029)
         -> GitHub outcomes (T030-T036)
         -> Operations/retention (T037-T044)
         -> Container/docs/CI/GitOps (T045-T050)
         -> Exact candidate PR and Canary (T051-T052)
         -> Final audit/human review (T053-T054)
         -> Separate exact Production approval -> Production/close (T055)
```

Within a phase, only `[P]` tasks may proceed concurrently, and shared migrations/contracts are frozen before dependent tasks. No automated triage task is permitted to invoke the development/release tasks represented by T051–T052 or T055.

## Implementation strategy

- **First usable slice**: T001–T020 yields governed, trusted, private intake with no automated GitHub writes.
- **Safe decision slice**: T021–T029 adds sequential research and validated recorded outcomes behind a mutation-disabled feature flag.
- **Mutation slice**: T030–T036 enables least-privilege GitHub changes only after isolated-repository fault tests pass.
- **Operational slice**: T037–T044 adds human visibility/recovery and deletion enforcement.
- **Release slice**: T045–T054 packages and proves the exact candidate; T055 remains separately approval-gated.

## Completion standard

No checkbox is complete on implementation alone. Its stated acceptance and verification evidence must pass, related task/checklist state must be updated promptly, and the repository must remain clean except for the intentional current task changes.

## Requirement coverage matrix

| Requirement | Tasks | Requirement | Tasks |
| --- | --- | --- | --- |
| FR-001 | T010, T044, T048–T050 | FR-002 | T010 |
| FR-003 | T010, T018–T020, T037–T041 | FR-004 | T010, T037 |
| FR-005 | T003–T004 | FR-006 | T014, T038 |
| FR-007 | T013, T015 | FR-008 | T015, T019 |
| FR-009 | T017–T019 | FR-010 | T016–T017 |
| FR-011 | T008, T018 | FR-012 | T020, T043 |
| FR-013 | T021, T029 | FR-014 | T021, T029, T048 |
| FR-015 | T027–T029 | FR-016 | T023–T025 |
| FR-017 | T023, T027, T032 | FR-018 | T025–T028 |
| FR-019 | T027, T030–T031 | FR-020 | T025–T026 |
| FR-021 | T026–T028 | FR-022 | T027, T029, T033–T035 |
| FR-023 | T030, T032–T033 | FR-024 | T031–T032, T034 |
| FR-025 | T035 | FR-026 | T032–T036 |
| FR-027 | T022, T047–T050 | FR-028 | T022, T036 |
| FR-029 | T021, T038–T039 | FR-029A | T021, T029, T042 |
| FR-030 | T011 and event-producing tests in T013–T044 | FR-031 | T007, T011, T024, T030–T031, T040 |
| FR-032 | T044, T048–T050 | FR-033 | T041, T044 |
| FR-034 | T001–T005, T047 | FR-035 | T045, T047–T055 |
| FR-036 | T004, T012, T046 | FR-037 | T003, T036, T047 |
| FR-038 | T003, T036, T051–T052, T055 |  |  |
| FR-039 | T007, T015, T018, T037–T043, T047–T050 | SC-011 | T007, T015, T018, T037–T043, T053 |
| SC-001 | T019, T053 | SC-002 | T015, T018 |
| SC-003 | T029, T040, T053 | SC-004 | T032–T036, T053 |
| SC-005 | T023, T032, T036 | SC-006 | T031, T034 |
| SC-007 | T021, T029, T048, T053 | SC-008 | T010, T015, T017–T018, T027, T036, T053 |
| SC-009 | T006, T012, T017, T045, T047, T053 | SC-010 | T048–T052, T055 |
