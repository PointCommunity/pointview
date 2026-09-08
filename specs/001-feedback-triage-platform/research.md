# Research: PointView Feedback Triage Platform

**Date**: 2026-09-07
**Scope**: Architecture and operating decisions needed to implement the approved product specification. Product-specific behavior remains governed by `spec.md`; this file records implementation evidence and rejected alternatives.

## Current PointGuide baseline

**Decision**: Adopt PointGuide's current repository-owned lifecycle skills, agent adapters, Project field vocabulary, quality gates, and immutable Canary-to-Production release contract, then remove PointGuide-only knowledge, evidence-Q&A, training, and Trainer-role behavior.

**Rationale**: Live inspection on 2026-09-07 established the source baseline: a private repository; a private organization Project with `Backlog`, `On Hold`, `In Progress`, `In Review`, and `Done`; `Priority`, `Impact`, and `Effort` fields; one active development Issue; `issue/<number>-<slug>` branches; `Refs #N` pull requests; exact-head Canary deployment; and same-digest Production promotion only after the explicit approval phrase. PointGuide's local pipeline work is uncommitted user-owned work, so PointView will reproduce the reviewed structure without modifying or committing the PointGuide checkout.

**Alternatives considered**:

- Depend on global skills only: rejected because lifecycle policy must travel with the repository and remain versioned with its code.
- Copy PointGuide product features wholesale: rejected because knowledge, corpus, training, and Trainer capabilities are expressly out of scope.

## Application stack

**Decision**: Use a single TypeScript application on Node.js 22 with Next.js 16 App Router, React 19, PostgreSQL 17, Drizzle ORM, Zod, JOSE, Sharp, the OpenAI JavaScript SDK, Vitest, Playwright, and axe-core. Pin compatible versions in the lockfile rather than floating ranges.

**Rationale**: This follows PointGuide's proven homelab runtime and verification shape while adding only the image-normalization and bounded model-client capabilities PointView needs. A single application image can serve authenticated web/API traffic and expose separate `triage:once` and `retention:once` commands for Kubernetes Jobs.

**Alternatives considered**:

- Separate frontend/backend/worker repositories: rejected for the initial scale because it multiplies release candidates and contracts without creating a useful isolation boundary.
- Reuse PointGuide as a module: rejected because it would couple PointView's independent data lifecycle and release cadence to unrelated training functionality.

## Trusted source-app launch

**Decision**: Each registered source app signs a short-lived EdDSA JWS containing issuer, audience, subject/context, issued/expiry times, and a nonce. Its backend submits the token to PointView through an HTML form POST. PointView verifies the active public key, consumes the nonce transactionally, stores a short-lived launch session, sets a Secure/HttpOnly/SameSite cookie, and redirects to the clean submission URL.

**Rationale**: The source-app private key never enters PointView, the browser cannot forge repository routing, form POST avoids placing the token in URL history and referrers, and nonce consumption closes replay. Key identifiers allow rotation with overlapping verification windows.

**Alternatives considered**:

- Repository/app name in query parameters: rejected because it is forgeable and would allow cross-repository mutation routing.
- Trust the HTTP referrer: rejected because it is optional, mutable, and not an authenticated assertion.
- One shared HMAC secret: rejected because compromise of PointView would permit it to forge source-app assertions.

## Authentication and authorization

**Decision**: Cloudflare Access provides authentication at the edge; a server-only data-access layer maps the verified identity to PointView's local `Pending`, `User`, `Admin`, or `Owner` authorization state. The first valid identity becomes Owner in one transaction, and the final active Owner is protected.

**Rationale**: This matches PointGuide's access model while keeping application authorization explicit and auditable. Route handlers never trust client-supplied roles or direct origin headers.

**Alternatives considered**:

- Cloudflare groups as the only authorization source: rejected because PointView requires versioned local approvals and resource-level ownership checks.
- Add PointGuide's Trainer role: rejected as unnecessary and explicitly out of scope.

## Screenshot intake and storage

**Decision**: Accept only PNG, JPEG, and WebP; cap at five files and 10 MiB each; validate decoded names, allowlisted extension, declared MIME, magic bytes, dimensions, and pixel count; decode and re-encode with Sharp to strip metadata; assign generated object names; optionally scan; store bytes on a private CephFS-backed RWX volume and store metadata/digests in PostgreSQL. Retrieval is through authorized handlers with `nosniff`, restrictive CSP, and non-inline disposition where appropriate.

**Rationale**: OWASP says there is no single upload-validation control and recommends defense in depth, allowlisted extensions, generated names, size limits, content checks, and storage outside the public web root. An RWX volume is already compatible with the homelab and allows both web and scheduled Job pods to access attachments. [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

**Alternatives considered**:

- PostgreSQL `bytea`: rejected because large image retention would bloat database backups and vacuum activity.
- Public static-file paths: rejected because raw feedback images are private and may contain personal information.
- Object storage: deferred because no existing approved homelab object-storage service was found; the storage adapter will keep this migration possible.

## Daily queue execution

**Decision**: Deploy a Kubernetes CronJob scheduled by default for 03:00 in `America/Chicago`, configurable through GitOps. Set `concurrencyPolicy: Forbid`. The command obtains a PostgreSQL singleton advisory lock, then repeatedly selects the oldest eligible record with `FOR UPDATE SKIP LOCKED`, creates an expiring lease, processes it to a terminal outcome or Needs Attention, and continues until no eligible record remains. A separate retention command uses the same image and never participates in triage leasing.

**Rationale**: Kubernetes documents CronJob scheduling as approximate and explicitly says Jobs should be idempotent because a schedule can occasionally create two Jobs or none. `Forbid` reduces overlap, while the database lock and operation markers are the actual correctness boundary. The application loop, not the scheduler, guarantees one-at-a-time drainage. [Kubernetes CronJob documentation](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/)

**Alternatives considered**:

- Always-on polling worker: rejected because it consumes resources and creates more operational state for a daily workload.
- One Kubernetes Job per feedback record: rejected because it weakens strict sequencing and adds unnecessary scheduling overhead.
- A record/runtime ceiling: rejected because the clarified requirement is to drain until empty unless an Owner pause or blocking integration failure makes safe progress impossible.

## Deterministic research acquisition

**Decision**: Deterministic adapters acquire and normalize evidence before model judgment. Per source app and batch, cache the target Project schema/items, non-Done Issues, Done history, open pull requests, and a shallow read-only repository checkout. Screen every non-Done Project Issue, rank bounded candidates through exact identifiers plus PostgreSQL text search/lexical similarity, and collect relevant code, documentation, test, and recent-history excerpts. Preserve a manifest proving the eligible set that was screened.

**Rationale**: This reduces repeated API/model cost while meeting the all-non-Done requirement. The model receives a bounded evidence packet rather than broad credentials or filesystem access. Done work remains historical context only.

**Alternatives considered**:

- Send the entire repository and every Issue to the model: rejected for cost, context limits, and data-minimization reasons.
- Use embeddings in the first release: rejected because deterministic lexical retrieval is inspectable and sufficient to establish the baseline; a versioned retrieval adapter leaves room for later evaluation.

## Model boundary and external research

**Decision**: Define a provider-neutral `TriageModel` interface with an initial OpenAI Responses API adapter. Use strict structured output, `store: false`, a bounded redacted evidence packet, optional normalized screenshot image inputs, and only the hosted `web_search` tool. Include the complete web-search source list, validate every cited evidence ID/URL against supplied or returned sources, and never expose GitHub, database, filesystem, provider-management, or cluster tools to the model. One primary decision call handles splitting and dispositions; a second call is reserved for risk triggers such as new-Issue creation, security/privacy content, low confidence, conflicting active matches, or materially mixed feedback.

**Rationale**: OpenAI's structured-output documentation supports strict JSON schemas, and its web-search documentation exposes the full consulted-source list. This keeps model work focused on judgment while deterministic application code owns authority and cost controls. [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [OpenAI Web Search](https://developers.openai.com/api/docs/guides/tools-web-search)

**Alternatives considered**:

- Codex App Server with shell tools: rejected for this service boundary because untrusted feedback would be placed too close to a process capable of reading local files; the product needs research judgment, not autonomous source mutation.
- Give the model GitHub mutation functions: rejected because authorization, idempotency, drift detection, and readback must remain deterministic.
- Always run two model calls: rejected because it doubles normal-case spend without evidence that every decision benefits.

## GitHub authentication and mutation

**Decision**: Use a private GitHub App installed only on registered target repositories. Request repository Metadata read, Contents read, Pull requests read, Issues read/write, and organization Projects read/write. Generate short-lived installation tokens at runtime, cache them only in memory, and perform REST/GraphQL requests through a deterministic adapter. Before a mutation, refresh the Issue and Project state; add a stable PointView operation marker; apply the smallest write; then read back and persist proof.

**Rationale**: GitHub App installation tokens are scoped to selected repositories and explicit permissions, expire after one hour, and support REST, GraphQL, and authenticated Git access. GitHub's Projects API requires adding an item and updating field values in separate calls, and returns the existing item when it is added twice; PointView must still make the whole multi-call operation idempotent. [GitHub App installation authentication](https://docs.github.com/en/enterprise-cloud%40latest/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation), [GitHub Projects API](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects)

**Alternatives considered**:

- Personal access token: rejected because it is tied to a human identity and typically has broader, longer-lived access.
- `gh` inside the runtime: rejected because a library adapter offers clearer token lifetime, response validation, retries, and test seams. Repository maintenance by developers still prioritizes `gh` and `git`.

## Disposition and Issue policy

**Decision**: Each feedback unit receives exactly one of `MERGED`, `CREATED`, or `CONSIDERED`. `MERGED` appends one privacy-minimized structured update to exactly one refreshed non-Done Issue. `CREATED` creates one open, unassigned HTML Issue, adds it to Backlog, and sets type/area/Priority/Impact/Effort through separate read-back-verified steps. `CONSIDERED` records why no mutation is justified. Triage never changes development Status or invokes a target repository's work/review/release pipeline.

**Rationale**: This is the smallest authority that satisfies the product purpose while preserving the human Project Manager as the only trigger for implementation work.

**Alternatives considered**:

- Reopen or update Done work automatically: rejected by the product requirement and because regression/returning-scope decisions deserve a new governed Issue.
- Let triage move high-confidence work to In Progress: rejected because it would bypass the human Project Manager and each app's one-active-Issue pipeline.

## Audit and retention

**Decision**: Retain raw feedback and screenshots for 180 days after every derived unit reaches a terminal disposition, then delete them through an audited daily retention job. Retain minimized research captures, decisions, GitHub operation/readback proofs, and audit records indefinitely. Users may withdraw only their own queued, unleased records; the tombstone retains identifiers and event metadata but not deleted content.

**Rationale**: This preserves a useful investigation window while bounding exposure of raw user content. OWASP recommends application-level security logging, interaction identifiers, sanitization against log injection, and removal/masking of tokens, secrets, session IDs, and unnecessary personal data. [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)

**Alternatives considered**:

- Indefinite raw retention: rejected as unnecessary privacy exposure.
- Immediate deletion after triage: rejected because it removes the short-term evidence needed to audit or correct a decision.
- Delete all derived records after 180 days: rejected because Issue provenance and mutation accountability must remain durable.

## Homelab deployment

**Decision**: Add separate `pointview-canary` and `pointview` GitOps applications, each with its own PostgreSQL data volume, private attachment volume, secrets, URL, web deployment, triage CronJob, and retention CronJob. Build one clean committed `linux/amd64` image locally, publish it to Zot, deploy the exact candidate digest to Canary, and promote that identical digest to Production only after approval.

**Rationale**: This mirrors PointGuide's proven release controls while isolating environments and preserving rollback identity. Final chart values and templates must be checked against the then-current homelab `app-template` and repository instructions immediately before deployment.

**Alternatives considered**:

- Shared Canary/Production database or attachment volume: rejected because it destroys environment isolation and safe test cleanup.
- Rebuild for Production: rejected because it changes the artifact after Canary approval.

## Resolved unknowns

There are no unresolved clarification markers. Default schedule time, model identifier, reasoning effort, retry budget, confidence thresholds, and retrieval limits are versioned operator settings with safe defaults; they do not change the clarified product semantics.
