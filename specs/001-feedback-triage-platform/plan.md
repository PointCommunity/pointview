# Implementation Plan: PointView Feedback Triage Platform

**Branch**: `001-feedback-triage-platform` | **Date**: 2026-09-07 | **Spec**: `specs/001-feedback-triage-platform/spec.md`
**Input**: Build a private, separately hosted feedback application that captures trusted source-app context, stores raw feedback/screenshots, drains a daily triage queue one item at a time, and deterministically applies research-backed GitHub Issue outcomes without starting development work.

## Summary

Create PointView as a private Next.js/TypeScript application with PostgreSQL persistence, Cloudflare Access identity, local role authorization, signed source-app launch tokens, sanitized private image storage, deterministic evidence acquisition, a credentialless model decision boundary, and idempotent GitHub App mutations. A Kubernetes CronJob starts daily and the application loop processes the oldest eligible feedback record sequentially until the queue is empty. PointView adopts PointGuide's repository-owned skills, Project fields, gates, and immutable Canary/Production release path, while excluding all knowledge and training features.

## Technical Context

**Language/Version**: TypeScript 6.0.x on Node.js 22 LTS
**Primary Dependencies**: Next.js 16.3.x, React 19.2.x, Drizzle ORM 0.45.x, `postgres` 3.4.x, Zod 4.5.x, JOSE 6.2.x, Sharp 0.35.x, OpenAI JavaScript SDK 7.10.x
**Storage**: PostgreSQL 17 for application state/audit; private CephFS RWX PVC for normalized screenshot bytes; 1Password-backed Kubernetes Secrets for credentials
**Testing**: Vitest 5 unit/integration/contract tests with 80% core line coverage; Playwright 1.63 browser tests; axe accessibility assertions; migration rehearsal; container/GitOps validation
**Target Platform**: Homelab Kubernetes, `linux/amd64`, Cloudflare Access, Zot registry, Gitea-backed Argo CD GitOps
**Project Type**: Single Next.js web application plus internal CLI entrypoints and a small TypeScript launch SDK workspace
**Performance Goals**: p95 authenticated page/API response under 500 ms excluding upload/model/GitHub calls; feedback acknowledgement under 2 seconds after image normalization; no model call for an empty queue; reuse one repository/Project snapshot per source app per batch; strictly one leased feedback record at a time
**Constraints**: Daily oldest-first drain until empty; no concurrent triage; raw content private and deleted 180 days after terminal triage; model has no credentials or mutation tools; all GitHub writes preconditioned, idempotent, and read back; triage never advances development state
**Scale/Scope**: Initial private church/product portfolio deployment, designed for tens of registered apps, thousands of submissions per year, up to 20,000 text characters and five 10 MiB images per submission; horizontal web scaling is allowed but triage remains singleton

## Constitution Check

### Pre-research gate

| Principle | Status | Evidence in approach |
| --- | --- | --- |
| I. Spec-first, evidence-first | Pass | Clarified specification, requirements/security/API/UX checklists, primary-source research, explicit assumptions |
| II. Deterministic authority | Pass | Model receives bounded evidence and web search only; application owns leases, validation, GitHub writes, retries, and readback |
| III. Privacy/untrusted input | Pass | Signed provenance, safe image re-encoding, private storage, minimized evidence, prompt-injection boundary, sanitized logs |
| IV. One controlled decision at a time | Pass | CronJob `Forbid`, PostgreSQL singleton lock, one active lease, oldest-first drain loop, terminal unit dispositions |
| V. Governed lifecycles | Pass | PointGuide Project/pipeline adoption; triage mutations cannot change status or invoke development lifecycle |
| VI. Accessible mobile-first quality | Pass | Dark-mode-first design, 320 px/200% zoom, keyboard/touch/AT testing, 44 px targets, 80% core line coverage |

### Post-design gate

Pass. The data model enforces singleton lease and terminal-disposition invariants; the HTTP contract exposes no public triage mutation; model and GitHub adapters are separated; retention is explicit; the source tree includes contract, security, accessibility, browser, and migration tests. No constitution exception is required.

## Architecture

### 1. Request and authorization boundary

- Cloudflare Access protects all user/admin routes; direct-origin traffic is denied by infrastructure and verified again by the server auth adapter.
- `src/server/auth/` converts verified Access identity into a short-lived PointView session and retrieves the local account through a server-only data-access layer.
- Authorization policies combine role and resource ownership. Users see only their records; Admins inspect operations and manage non-Owner accounts; Owners manage integrations/policy and Owner membership.
- CSRF protection, same-origin checks, CSP, secure cookies, security headers, and uniform Problem Details responses cover state-changing browser requests.

### 2. Source-app context boundary

- `packages/launch-sdk/` creates EdDSA-signed, five-minute JWS launch assertions and an auto-submitting POST form. It never sends a private key to the browser.
- `/launch` verifies issuer/audience/key/time/origin/return URL, atomically consumes the nonce, binds the launch to the authenticated account, and redirects without retaining the token in a URL.
- Source registrations map a source slug to one allowed GitHub repository, Project, installation, origin set, return URL set, and public-key set. Activation requires live integration readback.

### 3. Feedback and attachment boundary

- The submission transaction writes immutable provenance/queue metadata and raw text; attachment bytes are staged with restrictive permissions, decoded under hard resource limits, re-encoded, hashed, committed to a generated private storage key, then associated with the record.
- Failure compensates staged objects and database rows safely. Retrieval always performs record-level authorization and logs access without logging file content.
- Raw text is kept in a separate one-to-one payload table so retention can erase it without destroying durable provenance and decision lineage.

### 4. Scheduling and lease boundary

- Kubernetes schedules `npm run triage:once` daily at a GitOps-configured time (default 03:00 `America/Chicago`) with `concurrencyPolicy: Forbid`.
- The command takes a global PostgreSQL advisory lock; if another batch exists, it exits successfully with an audit event and no model call.
- A transactional `FOR UPDATE SKIP LOCKED` query leases only the oldest eligible record. Heartbeats and lease expiry support crash recovery.
- Record-specific exhausted failures become Needs Attention and the batch continues. Only Owner pause or a classified blocking integration failure ends a non-empty batch before drainage.

### 5. Evidence and decision boundary

- Deterministic GitHub/repository collectors build a versioned evidence manifest covering the Project schema, every non-Done Project Issue, Done history, open PRs, and relevant code/docs/tests/history.
- Retrieval ranks candidates locally and records the complete eligible-ID manifest. Bounded, sanitized excerpts and normalized screenshots form the model packet.
- The OpenAI Responses adapter uses strict structured output, `store: false`, hosted web search, explicit primary-source guidance, source-list capture, timeouts, usage accounting, and no mutation function.
- Schema, evidence-reference, routing, privacy, Issue-eligibility, label/field, and risk-review validators must all pass before a decision is actionable.

### 6. GitHub application boundary

- A private GitHub App creates short-lived installation tokens in memory. It has read-only Contents/Pull requests/Metadata and write Issues/organization Projects only for registered repositories.
- `MERGED` adds one structured HTML comment to one refreshed non-Done Issue.
- `CREATED` creates one HTML Issue, adds labels, adds the Issue to the target Project, sets Backlog/Priority/Impact/Effort through ordered mutations, and verifies every resulting field.
- Each step embeds/searches a stable operation marker and stores intended-payload plus readback digests, preventing duplicates after uncertain network responses.
- `CONSIDERED` never calls a GitHub mutation endpoint.

### 7. Operations and retention boundary

- Operator pages show queue age, lease/batch history, sanitized evidence, decision validation, usage/cost, rate limits, retries, Needs Attention, and readback proof.
- `npm run retention:once` deletes eligible raw payloads and attachment bytes after 180 days, verifies absence, and preserves only minimized durable lineage and audit events.
- Health proves process liveness. Readiness checks schema version, database, writable attachment storage, required registry/configuration, and configured GitHub integration without making a model call.

### 8. Delivery boundary

- Repository root contains PointView-adapted PointGuide lifecycle skills and deterministic audits. GitHub CI runs the complete non-deployment gate set.
- Canary and Production use separate databases, attachment PVCs, secrets, domains, and Argo applications.
- One clean committed AMD64 image is published to Zot. Canary deploys the exact PR head; Production reuses the identical approved digest.

## Repository and Project bootstrap

The repository does not yet have a remote or initial commit, so a one-time root-of-trust bootstrap is necessary before the normal Issue branch workflow can govern itself:

1. After plan and exact Issue approval, create private `PointCommunity/pointview` with `main`, Issues, Projects, branch protection/ruleset, security features, and no public artifacts.
2. Copy PointGuide's private Project structure (fields/views only, no items) into a private `PointView` organization Project; link the new repository and verify every option ID/readback.
3. Adapt PointGuide's current `AGENTS.md`, agent adapters, lifecycle/shared skills, workflow, labels, audits, and CI. Remove knowledge/training references and replace PointGuide identifiers/domains with PointView equivalents.
4. Make the single bootstrap commit containing only governance, approved spec/design/tasks, and minimum CI/repository scaffolding on `main`; tag its purpose in the commit message and record its tree SHA.
5. Create the approved implementation Issue as Issue #1, add it to Backlog with governed metadata, and read back all fields.
6. Treat the original Project Manager request as the explicit work selection: move Issue #1 to In Progress, create `issue/1-feedback-triage-platform`, and perform all application work there through the normal pipeline.

No later feature receives a bootstrap exception.

## GitHub Project structure to adopt

| Field | Values / rule |
| --- | --- |
| Status | Backlog, On Hold, In Progress, In Review, Done |
| Priority | P0, P1, P2, P3 |
| Impact | High, Medium, Low |
| Effort | XS, S, M, L, XL |
| Type labels | `type:bug`, `type:feature`, `type:maintenance`, `type:security` |
| Area labels | PointGuide base adapted with PointView areas: `area:ai`, `area:data`, `area:deployment`, `area:documentation`, `area:feedback`, `area:github`, `area:identity`, `area:security`, `area:ui`, `area:workflow` |
| Active development | At most one Issue in In Progress or In Review; automated triage is not development activation |
| Default new work | Open, unassigned, Backlog |

## Project Structure

### Feature artifacts

```text
specs/001-feedback-triage-platform/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── tasks.md
├── contracts/
│   ├── launch-context.schema.json
│   ├── openapi.yaml
│   └── triage-decision.schema.json
└── checklists/
    ├── api.md
    ├── requirements.md
    ├── security.md
    └── ux.md
```

### Application repository

```text
.
├── AGENTS.md
├── CLAUDE.md -> AGENTS.md
├── GEMINI.md -> AGENTS.md
├── .agents/skills/
│   ├── pointview-pipeline/
│   ├── pointview-create-issue/
│   ├── pointview-audit-issues/
│   ├── pointview-work-issue/
│   ├── pointview-review-issue/
│   ├── pointview-release-canary/
│   ├── pointview-release-production/
│   ├── pointview-close-issue/
│   ├── pointview-pipeline-health/
│   ├── pointview-maintain-skills/
│   └── [adopted shared design/browser skills]
├── .claude/
├── .github/workflows/ci.yml
├── docs/
│   ├── architecture.html
│   ├── development-pipeline-policy.html
│   ├── operations.html
│   ├── privacy-and-retention.html
│   └── source-app-integration.html
├── packages/launch-sdk/
│   ├── src/
│   └── tests/
├── scripts/
│   ├── audit-agent-skills.mjs
│   ├── audit-ci-alignment.mjs
│   ├── audit-github-project.mjs
│   ├── audit-project-alignment.mjs
│   ├── audit-runtime-skills.mjs
│   ├── render-issue.mjs
│   └── verify-live.mjs
├── src/
│   ├── app/
│   │   ├── (authenticated)/feedback/
│   │   ├── (authenticated)/admin/
│   │   ├── api/
│   │   └── launch/
│   ├── components/
│   ├── server/
│   │   ├── auth/
│   │   ├── audit/
│   │   ├── config/
│   │   ├── db/
│   │   ├── feedback/
│   │   ├── github/
│   │   ├── launch/
│   │   ├── research/
│   │   ├── retention/
│   │   ├── storage/
│   │   └── triage/
│   └── styles/
├── tests/
│   ├── contract/
│   ├── integration/
│   ├── security/
│   ├── unit/
│   └── visual/
├── e2e/
├── migrations/
├── Dockerfile
├── package.json
└── vitest.config.ts
```

### Homelab GitOps changes (separate repository)

```text
/Users/chris/Documents/Github/homelab/apps/
├── pointview-canary/
│   ├── Chart.yaml
│   └── values.yaml
└── pointview/
    ├── Chart.yaml
    └── values.yaml
```

**Structure decision**: Use one deployable application repository with server-only modules and CLI entrypoints, plus a small launch SDK workspace. Keep environment deployment state in the canonical homelab repository. This preserves one application release identity while making trust boundaries testable at module interfaces.

## Implementation increments

1. **Governed foundation**: repository/Project bootstrap, adopted skills/policy/audits, CI, app skeleton, configuration, database/migrations, auth/roles, audit ledger.
2. **Trusted intake MVP**: source registration, launch SDK/JWS verification, feedback UI/API, safe attachment pipeline, own-record status, withdrawal.
3. **Sequential triage engine**: CronJob command, batch/lease state machine, recovery, deterministic evidence collection, candidate screening, OpenAI structured-decision adapter, validation and risk review.
4. **GitHub outcomes**: least-privilege GitHub App adapter, merge/create/consider operations, Project field application, markers, rate-limit behavior, readback proof.
5. **Operations and retention**: dashboards, Needs Attention recovery, settings, retention deletion, health/readiness, metrics, alerting.
6. **Release hardening**: complete security/accessibility/browser/load/failure tests, dark-mode HTML documentation, exact-image build, isolated Canary deployment and live validation.

Each increment starts with failing tests for its behavior, ends with its independent acceptance scenario, and keeps the application buildable.

The PointView release proves source linking with its SDK interoperability fixture. Adding the Feedback link and signing endpoint to any real source application remains a separate Issue in that application's repository, selected by the human Project Manager and executed through that application's own pipeline.

## Validation strategy

- **Static**: formatting, lint, TypeScript, dependency lock integrity, secret/SAST/SCA scans, repository-skill and pipeline audits.
- **Unit/property**: state transitions, role matrix, token time/audience/nonce, path/MIME/magic/pixel limits, redaction, evidence IDs, disposition invariants, idempotency keys, retry classification.
- **Contract**: OpenAPI, launch JWS schema, model decision schema, GitHub REST/GraphQL fixtures, Project field mapping.
- **Integration**: PostgreSQL locks/`SKIP LOCKED`, concurrent claim attempts, expired leases, attachment compensation/deletion, first-Owner race, final-Owner protection, GitHub lost-response recovery.
- **Adversarial**: prompt injection in feedback/Issues/code/web, forged routing, replay, cross-user object IDs, upload polyglots/bombs, log injection, SSRF attempts, unsafe model citations/mutations.
- **Browser/accessibility**: 320/768/1280 px, 200% zoom, keyboard-only, touch target sizing, focus/error/status announcements, reduced motion, axe, upload and admin flows.
- **Release**: clean-tree production build, migration forward/rollback rehearsal, `linux/amd64` image inspection, CI head/tree identity, Canary digest/runtime/API/UI/Job checks, whole-cluster health, same-digest Production promotion/readback.

## Risks and mitigations

| Risk | Mitigation | Validation |
| --- | --- | --- |
| Prompt injection produces an unsafe decision | Treat all evidence as data; no model credentials/tools except web search; strict schema/evidence/routing validators; risk review | Adversarial fixture suite |
| Duplicate Issue/comment after lost response | Stable operation marker; search-before-write; ordered operation ledger; readback | Fault-injected integration test |
| Issue becomes Done between research and apply | Refresh target and Project status immediately before mutation; invalidate decision on drift | Drift contract test |
| CronJob overlaps or duplicates | `Forbid` plus database singleton lock and one global active lease | Concurrent Job test |
| Queue cannot drain due to one bad record | Classify local vs global failures; Needs Attention isolates local exhaustion; continue safely | Mixed-failure batch test |
| Screenshots disclose sensitive content | Explicit user upload/notice; normalization; private ACL; role checks; no GitHub copy; 180-day deletion | Cross-user/security/retention tests |
| GitHub permissions are broader than intended | Repository-selective private App; enumerated permissions; activation readback; secrets outside DB | Permission inventory and negative tests |
| Model/API cost grows unexpectedly | Empty-queue fast path, cached source snapshot, deterministic candidate ranking, bounded packets, one-call default, usage/cost telemetry | Budget fixture and metrics test |
| Long daily drain exceeds infrastructure assumptions | No arbitrary record ceiling; heartbeat leases; `Forbid`; alert while running; Owner pause; resumable batch | Long-running restart test |

## Complexity Tracking

No constitution violations. The launch SDK, separate raw payload table, and deterministic GitHub operation ledger are additional components justified by provenance, retention, and idempotency requirements rather than architectural preference.

## Planning gate

Implementation and remote mutations begin only after the human reviews this plan and the exact bootstrap Issue draft. Approval authorizes the named private repository/Project bootstrap and Issue #1 creation, but Production still requires the separate exact phrase `Approved to merge and deploy production` for the recorded Canary candidate.
