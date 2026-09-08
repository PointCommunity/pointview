# Feature Specification: PointView Feedback Triage Platform

**Feature Branch**: `001-feedback-triage-platform`
**Created**: 2026-09-07
**Status**: Clarified — ready for planning
**Input**: Build a separately hosted feedback application that automatically captures source-app context, stores raw feedback and screenshots, researches each submission, and safely merges, creates, splits, or considers GitHub Issues on a schedule.

## Assumptions

- PointView will be a private `PointCommunity/pointview` repository and use a private organization Project titled `PointView` with PointGuide's Status, Priority, Impact, and Effort fields.
- PointView will use PointGuide's first-login Owner and later-account Pending model, with User, Admin, and Owner roles; PointGuide's Trainer role and all knowledge/training features are excluded.
- Registered source apps may target different PointCommunity repositories and Projects. The PointView Project governs PointView's own development, while feedback is routed to the registered source app's repository and Project.
- Source context is asserted by a short-lived signed launch token produced by the source app. Unverified query parameters or referrer headers are never treated as trusted provenance.
- GitHub receives a privacy-minimized research summary and protected PointView record link, not raw screenshots or unnecessary submitter identity.

## User Scenarios & Testing

### User Story 1 — Submit contextual feedback (Priority: P1)

An approved user follows a Feedback link from another application, sees that application and current context already identified, writes feedback, optionally adds screenshots, and submits without selecting a product or repository.

**Why this priority**: A low-friction, correctly attributed submission is the product's essential user value.

**Independent Test**: Launch PointView from a registered test application with a valid signed context, submit text and an image, and verify one immutable raw record contains the displayed source context and attachment metadata.

**Acceptance Scenarios**:

1. **Given** an approved user and a valid unexpired launch context, **When** the user opens PointView, **Then** the source application and captured page context are displayed and cannot be silently changed by the browser.
2. **Given** valid feedback text and zero or more allowed screenshots, **When** the user submits, **Then** PointView acknowledges one durable record and the user need not choose a repository, Project, labels, or Issue.
3. **Given** a missing, invalid, expired, replayed, or disabled source context, **When** PointView is opened, **Then** submission fails closed with a recovery path and no falsely attributed record is created.

---

### User Story 2 — Research and triage the daily queue safely (Priority: P1)

Once daily, PointView starts a triage batch that drains all eligible feedback present in the queue. It leases and completes one feedback record at a time, researches its source repository and current GitHub work, splits mixed feedback when needed, and produces a validated decision for every resulting unit before leasing the next record.

**Why this priority**: Automated, evidence-grounded judgment is the primary operational purpose of PointView.

**Independent Test**: Seed fixtures containing a duplicate, novel request, mixed request, insufficient report, malicious prompt injection, and transient GitHub failure; trigger one daily batch and verify sequential leases, dispositions, evidence, retries, isolation, and complete queue drainage.

**Acceptance Scenarios**:

1. **Given** queued feedback, **When** the daily batch begins, **Then** exactly one eligible record is leased with an expiring lock and an idempotency key.
2. **Given** a record containing multiple independently actionable ideas, **When** it is analyzed, **Then** it is split into traceable units that may receive different dispositions.
3. **Given** an analysis unit, **When** research runs, **Then** PointView inspects the current target Project and all Issues whose Status is not Done, relevant open pull requests, repository code/docs/history, and appropriate current primary external sources.
4. **Given** untrusted feedback, Issue, repository, or web content containing instructions, **When** the model analyzes it, **Then** embedded instructions are ignored and the model has no credential or mutation authority.
5. **Given** incomplete or conflicting evidence, **When** a confident Issue mutation cannot be justified, **Then** the unit is marked Considered with the uncertainty and next useful evidence recorded.
6. **Given** more eligible records after one record reaches a terminal triage state, **When** the batch continues, **Then** the next oldest eligible record is leased; the batch stops only when no eligible record remains, an Owner pauses triage, or a blocking integration failure prevents safe progress.

---

### User Story 3 — Apply traceable GitHub outcomes (Priority: P1)

PointView converts each validated decision into the smallest justified GitHub change: enrich one eligible existing Issue, create one new Backlog Issue, or make no GitHub change.

**Why this priority**: The workflow only saves effort if sound decisions become clean, non-duplicative work records.

**Independent Test**: Run deterministic GitHub adapters against fixtures and an isolated test repository, then verify exact Issue body/comment, Project fields, idempotency, and readback behavior.

**Acceptance Scenarios**:

1. **Given** a strong match to one non-Done Issue, **When** the decision is applied, **Then** a structured research update and PointView record reference are added once without changing the Issue's development Status.
2. **Given** no adequate non-Done match and sufficient evidence for actionable work, **When** the decision is applied, **Then** one coherent Issue is created open, unassigned, placed in the target Project Backlog, and populated with governed metadata.
3. **Given** a Consider disposition, **When** the decision is finalized, **Then** no GitHub mutation occurs and the rationale remains reviewable in PointView.
4. **Given** a retry after an uncertain response, **When** the adapter reruns, **Then** it detects the prior PointView operation marker and does not create duplicate content or Issues.
5. **Given** a triaged Issue is in Backlog, On Hold, In Progress, or In Review, **When** PointView adds or creates feedback-derived work, **Then** it does not activate, implement, branch, create a pull request for, review, release, close, or otherwise advance that development work.

---

### User Story 4 — Operate and audit the system (Priority: P2)

Admins can review submissions, research evidence, split units, decisions, GitHub readbacks, failures, and schedule health; Owners can manage approved accounts, registered source apps, provider profiles, GitHub installation mappings, retention policy, and triage pause controls. The daily CronJob schedule itself remains governed deployment configuration so the application never needs cluster mutation credentials.

**Why this priority**: Automated mutation requires human observability, recovery, and least-privilege configuration.

**Independent Test**: Exercise role-specific pages and APIs using fixture identities and verify that each role sees and changes only authorized data.

**Acceptance Scenarios**:

1. **Given** a User, **When** they view PointView, **Then** they can submit and inspect only their own feedback and sanitized processing status.
2. **Given** an Admin, **When** they inspect a record, **Then** they can see raw feedback, safe attachment previews, research citations, decisions, retries, and GitHub outcomes but cannot change Owner-only secrets or agent policy.
3. **Given** an Owner, **When** they update a source-app registration, model profile, GitHub installation mapping, retention policy, or triage pause, **Then** the change is versioned and audit logged without exposing secret values.
4. **Given** a stuck lease, rate limit, provider outage, invalid model output, GitHub drift, or partial mutation, **When** recovery runs, **Then** PointView retries safely or moves the record to Needs Attention with precise non-secret evidence.

---

### User Story 5 — Release PointView safely (Priority: P2)

PointView changes follow the same governed Issue-to-Canary-to-Production path as PointGuide.

**Why this priority**: The app controls private feedback and mutates project-management data, so releases require exact provenance and rollback.

**Independent Test**: Validate one exact candidate through local gates, GitHub CI, immutable Zot publication, Canary GitOps deployment, explicit approval, same-digest Production promotion, and post-release verification.

**Acceptance Scenarios**:

1. **Given** a complete PointView development Issue, **When** agent QA passes, **Then** the exact clean PR head is deployed to Canary and the Issue moves to In Review.
2. **Given** the exact phrase `Approved to merge and deploy production` for the live candidate, **When** release proceeds, **Then** the approved tree is merged and the identical Canary digest is promoted without rebuilding.
3. **Given** Production and the homelab are verified healthy, **When** completion runs, **Then** obsolete unreferenced PointView manifests are cleaned safely and the Issue becomes Done.

## Edge Cases

- Multiple users submit substantially identical feedback before any record is processed.
- One submission contains a bug, a feature request, and an unrelated question.
- A candidate Issue changes Status to Done between research and mutation.
- Two Issues are plausible matches, or an open PR appears to implement the request already.
- A Done Issue addressed the idea but the behavior regressed; the new feedback may justify a new bug rather than reopening or mutating Done.
- An attachment has a misleading extension, invalid image bytes, decompression-bomb characteristics, malware, embedded active content, or sensitive information.
- A launch token is replayed, source-app configuration changes mid-session, or the target repository/Project becomes unavailable.
- GitHub accepts a mutation but the network response is lost.
- A model returns malformed output, cites evidence it was not given, follows prompt injection, or recommends a mutation outside the registered target.
- The queue grows faster than the configured schedule can drain it.

## Requirements

### Functional Requirements

- **FR-001**: PointView MUST authenticate through Cloudflare Access and authorize through its own database.
- **FR-002**: The first valid identity MUST become the approved Owner transactionally; later identities MUST begin Pending. A same-origin Owner-administration POST protected by a valid Cloudflare Access assertion MUST provide the initial Owner session without requiring a source app to exist first; it MUST NOT create a session for non-Owners.
- **FR-003**: Approved Users MUST be able to submit feedback and view only their own submissions; Admins MUST be able to review operational records and manage non-Owner accounts; Owners MUST exclusively manage integration mappings and external secret references, model/prompt policy, source apps, triage pause, retention, and Owner membership. The daily CronJob schedule MUST remain deployment-controlled and MUST NOT give the web application cluster mutation credentials.
- **FR-004**: The final active Owner MUST NOT be demoted or suspended.
- **FR-005**: PointView MUST exclude PointGuide knowledge repositories, corpus indexing, evidence Q&A, training sessions, and learning-proposal functionality.
- **FR-006**: Each registered source app MUST define an immutable identifier, display name, target GitHub repository, target private Project, allowed origins, enabled state, and rotating launch-verification keys.
- **FR-007**: Launch context MUST be signed, short lived, single-use, audience bound, and include source app, environment, route or screen, application version or source revision when available, issued/expiry times, and a nonce.
- **FR-008**: The submission page MUST show the verified source application and captured context before submission without requiring the user to categorize the feedback.
- **FR-009**: A submission MUST accept bounded plain text and up to five explicit PNG, JPEG, or WebP screenshots of at most 10 MiB each.
- **FR-010**: Upload handling MUST validate decoded filename, extension, declared type, file signature, dimensions, pixel count, and successful safe image decode; rename files to generated identifiers; reject active formats; prevent public retrieval; and support malware scanning without trusting scanner success as the only control.
- **FR-011**: Raw feedback, attachment metadata, checksums, verified source context, submitter account, timestamps, and consent/privacy acknowledgement MUST be stored immutably; corrections MUST be append-only annotations.
- **FR-012**: Raw feedback and screenshots MUST be retained for 180 days after every derived unit reaches a terminal triage disposition, then deleted by an audited retention job. The minimized research captures, decisions, GitHub-operation proofs, and audit records MUST be retained indefinitely. Submitters MAY withdraw and delete their own records only while they remain queued and unleased; withdrawal MUST create a tombstone audit event without retaining the deleted raw content.
- **FR-013**: The scheduled worker MUST lease and process exactly one feedback record at a time using transactional skip-locked selection, lease expiry, bounded retries, deterministic idempotency keys, and an invariant that prevents concurrent triage execution.
- **FR-014**: PointView MUST start one triage batch daily. The batch MUST process eligible records oldest-first, sequentially, until the queue is empty; it MUST make no model call when the queue is empty.
- **FR-015**: The system MUST split a mixed submission into independently traceable units when those units do not share one coherent outcome and verification path.
- **FR-016**: Before deciding a unit, PointView MUST capture the target Project schema and all current Project Issues except Done, relevant open pull requests, and repository-specific code, docs, tests, and recent history.
- **FR-017**: PointView MAY consult Done/closed work only as historical evidence and MUST NOT merge new feedback into a Done Issue without a new explicitly governed workflow.
- **FR-018**: External research MUST prefer current primary authorities, record URL, title, publisher, applicability, capture time, and content digest, and make unresolved product-specific facts explicit.
- **FR-019**: Every substantive claim in an Issue proposal or merge summary MUST map to captured evidence; feedback itself MUST be labeled user evidence, not objective proof.
- **FR-020**: The model MUST receive only a bounded, redacted evidence packet and MUST run without GitHub, database, provider, filesystem, or cluster credentials and without mutation tools.
- **FR-021**: Model output MUST conform to a versioned schema and be rejected if it contains unsupported citations, unknown repositories/Projects, invalid dispositions, unsafe content, or ambiguous mappings.
- **FR-022**: Each unit MUST end in exactly one disposition: `MERGED`, `CREATED`, or `CONSIDERED`; a split submission MUST preserve parent/child traceability across all units.
- **FR-023**: `MERGED` MUST identify exactly one eligible non-Done Issue and add a structured, privacy-minimized, idempotent research update without changing its Status, scope, assignee, or unrelated metadata.
- **FR-024**: `CREATED` MUST produce one coherent HTML Issue containing Summary, User evidence, Research, Scope, Acceptance criteria, Verification, Out of scope, and a protected PointView record link; it MUST be open, unassigned, Backlog, and have exactly one governed type label, one or more area labels, Priority, Impact, and Effort.
- **FR-025**: `CONSIDERED` MUST record a reason code, explanation, research evidence, confidence, and optional revisit condition without mutating GitHub.
- **FR-026**: Before every GitHub write, deterministic code MUST refresh the target Issue/Project state, revalidate eligibility, apply with an operation marker, and read the result back.
- **FR-027**: GitHub writes MUST use a least-privilege GitHub App installation restricted to explicitly registered repositories and the required Issue/Project permissions.
- **FR-028**: Rate-limit and abuse-limit responses MUST be honored with server-directed delay where present, exponential backoff with jitter, queue preservation, and no concurrent content creation.
- **FR-029**: Owners MUST be able to pause all triage or one source app immediately without losing queued work.
- **FR-029A**: A daily batch MUST continue until the eligible queue is empty. An Owner pause or blocking integration failure MAY stop the batch; PointView MUST preserve queue order, surface the interruption, and resume oldest-first on the next authorized continuation. A record-specific terminal failure MUST move only that record to Needs Attention and MUST NOT prevent the batch from continuing when later records can be processed safely.
- **FR-030**: Every authentication, authorization, upload, research, decision, configuration, secret rotation, queue transition, GitHub request outcome, recovery, and administrative access event MUST create a sanitized audit record with correlation and operation identifiers.
- **FR-031**: Logs and GitHub content MUST exclude credentials, raw access assertions, raw provider output, unnecessary email/IP/user-agent data, and raw screenshots.
- **FR-032**: PointView MUST expose health and readiness separately; readiness MUST fail when migrations, storage, schedule ownership, required source registry, or configured GitHub integration is unusable.
- **FR-033**: Queue age, disposition counts, retries, Needs Attention records, provider failures, GitHub rate limits, and last successful scheduled cycle MUST be visible to authorized operators.
- **FR-034**: PointView's development Project MUST match PointGuide's five Status values and Priority, Impact, and Effort fields, enforce one active development Issue, and use adapted repository lifecycle skills plus deterministic alignment checks.
- **FR-035**: PointView releases MUST use clean committed AMD64 images, immutable Zot digests, separate `pointview-canary` and `pointview` GitOps applications, exact-candidate Canary review, explicit Production approval, same-digest promotion, data-safe rollback, whole-cluster verification, and safe obsolete-manifest cleanup.
- **FR-036**: Human-facing product, policy, research, and architecture documents MUST be accessible responsive HTML in dark mode; required agent workflow artifacts MAY remain Markdown.
- **FR-037**: Automated triage MUST NOT move a target Issue's development Status, assign implementation ownership, create or change a development branch or pull request, run source implementation, invoke an app's review/release skill, merge code, deploy, close an Issue, or set Done.
- **FR-038**: Only an explicit human Project Manager instruction, interpreted under the target application's own repository pipeline, MAY begin or advance development work on a triaged Issue.
- **FR-039**: PointView MUST enforce deployment-edge and application-level rate/resource limits on launch, feedback submission, attachment retrieval, administrative mutations, and other abuse-sensitive endpoints using trusted account/source keys where available; throttled responses MUST use `429` with `Retry-After`, and limits MUST NOT depend solely on attacker-controlled headers.

### Key Entities

- **Account**: Authenticated identity, application role/status, lifecycle timestamps, and version.
- **Source App**: Trusted launch issuer and mapping to one GitHub repository and private Project.
- **Launch Context**: Signed, single-use provenance for the source app, environment, route/screen, revision, and return destination.
- **Feedback Record**: Immutable raw submission, submitter, source context, queue state, and retention lifecycle.
- **Attachment**: Private screenshot object with safe metadata, checksum, scan/decode state, and access audit.
- **Feedback Unit**: One coherent concern derived from a raw record and linked to sibling units.
- **Research Capture**: Versioned repository, GitHub, or web evidence with locator, applicability, capture time, and digest.
- **Triage Decision**: Versioned disposition, confidence, rationale, evidence references, proposed mutation, and validation state.
- **GitHub Operation**: Idempotent intended mutation, request/response metadata, readback proof, and recovery state.
- **Job Lease**: One scheduled unit of work with availability, lease owner/expiry, attempts, and terminal result.
- **Audit Event**: Sanitized actor, action, target, outcome, correlation, and timestamp record.

## Success Criteria

- **SC-001**: At least 95% of first-time approved users can submit valid text-only feedback from a registered source app in under two minutes without selecting product or GitHub metadata.
- **SC-002**: 100% of accepted submissions have cryptographically verified source-app identity and immutable source-context provenance.
- **SC-003**: Every processed record has complete parent/unit lineage, captured research, one terminal disposition per unit, and a reproducible audit trail.
- **SC-004**: Fixture and isolated-repository tests produce zero duplicate Issues or duplicate merge updates across retries, lost responses, worker restarts, and concurrent claim attempts.
- **SC-005**: No mutation is applied to an Issue whose refreshed Project Status is Done, and no automated triage mutation changes a target Issue's development Status.
- **SC-006**: 100% of created Issues contain evidence-linked scope, measurable acceptance criteria, verification, governed labels/fields, and a protected PointView source reference.
- **SC-007**: One daily batch leases no more than one record concurrently, processes eligible records oldest-first, drains the queue unless an Owner pauses it or a recorded blocking integration failure prevents safe progress, recovers stuck leases, continues past isolated terminal record failures when safe, and exposes exhausted retries as Needs Attention without data loss.
- **SC-008**: Unauthorized role, cross-user record access, forged/replayed context, unsafe upload, unsupported model citation, and out-of-scope GitHub mutation tests all fail closed.
- **SC-009**: Core logic maintains at least 80% line coverage and all required source, security, upload, migration, accessibility, responsive-browser, production-build, and AMD64 container gates pass.
- **SC-010**: Canary and Production run separate databases/storage, URLs, secrets, and Argo applications; the approved immutable Canary digest is promoted to Production without rebuilding and rollback evidence is verified.
- **SC-011**: Repeated launch, submission, attachment, and administrative requests above configured test limits receive deterministic `429` responses with `Retry-After` while unrelated authorized accounts remain usable and no raw request content is logged.

## Out of Scope

- Automatically implementing, merging, or deploying the product Issues created from feedback.
- Automatically invoking or advancing any target application's development pipeline; the human Project Manager triggers that workflow.
- Modifying target application repositories to add their Feedback link or signing endpoint. PointView supplies the versioned launch contract/SDK and test fixture; each source-app integration is a separate governed Issue that the human Project Manager starts through that app's pipeline.
- Reopening or mutating Done Issues automatically.
- Public or anonymous feedback intake in the initial release.
- Video, audio, arbitrary document, archive, or executable uploads.
- PointGuide knowledge indexing, question answering, training sessions, or learning proposals.
- Silent screenshot capture, screen recording, or collection of unrelated browser/application content.

## Clarifications

- 2026-09-07: Triage runs daily and drains the eligible queue sequentially, one record at a time, until empty. It performs triage only; the human Project Manager triggers each app's development pipeline.
- 2026-09-07: Raw feedback and screenshots are retained for 180 days after terminal triage, then deleted by an audited retention job. Minimized research, decisions, mutation proofs, and audit records remain indefinitely. Submitters may withdraw only queued, unleased records.
