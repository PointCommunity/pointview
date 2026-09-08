# Quickstart: PointView Feedback Triage Platform

This is the implementation and acceptance-test path for the approved design. Commands are provisional until the repository scaffold and lockfile exist.

## Local prerequisites

- Node.js 22 and npm
- PostgreSQL 17
- A private writable attachment directory outside the web root
- A test Cloudflare Access assertion fixture accepted only in `NODE_ENV=test`
- An isolated GitHub test repository/Project or recorded API fixtures
- An OpenAI test key for opt-in live smoke tests; normal tests use deterministic fixtures

## Expected local commands

```bash
npm ci
npm run db:migrate
npm test
npm run lint
npm run typecheck
npm run build
```

Use separate explicit commands for integration and browser suites so failures retain their evidence:

```bash
npm run test:integration
```

```bash
npm run test:e2e
```

Live provider/GitHub smoke tests are opt-in and must target test resources:

```bash
POINTVIEW_LIVE_SMOKE=1 npm run test:live
```

## Scenario 1: Register a source app

1. Start with an active Owner account.
2. Create a disabled source registration naming the exact repository, private Project node ID/number, GitHub App installation ID, HTTPS origin allowlist, return URL allowlist, and at least one Ed25519 public key.
3. Run validation. Confirm repository identity, installation repository access, Project identity and schema, required labels, and non-Done statuses are read back.
4. Enable the source app only after every check passes.

Expected result: no secret values exist in the database, and the audit event references the configuration version and readback digest.

## Scenario 2: Launch from a source app

The source backend uses `packages/launch-sdk` to sign a five-minute assertion with a unique nonce and renders an auto-submitting form whose action is PointView `/launch` and whose only field is `launch_token`.

Test claims:

```json
{
  "iss": "sample-app",
  "aud": "pointview",
  "iat": 1788811200,
  "exp": 1788811500,
  "jti": "test-nonce-0000000001",
  "source_app": "sample-app",
  "environment": "canary",
  "context": {
    "location": "/settings/profile",
    "screen_name": "Profile settings",
    "app_version": "1.2.3",
    "source_revision": "abc1234",
    "return_url": "https://sample-canary.eaglepass.io/settings/profile"
  }
}
```

Expected result: PointView consumes the nonce once, binds the launch session to the signed-in account, displays verified source/context as read-only, and redirects to a token-free URL. Replay, expiry, wrong audience, unknown key, disabled source, bad origin, and disallowed return URL all fail closed.

## Scenario 3: Submit and withdraw feedback

1. Submit text-only feedback; confirm one queued record and no model call.
2. Submit text plus five valid screenshots; confirm each image was decoded/re-encoded and private metadata/digest stored.
3. Try a sixth image, >10 MiB image, wrong magic bytes, active format, excessive dimensions/pixels, malformed image, and path-like filename; confirm rejection and staged-file cleanup.
4. As another User, try to read the record and attachment; confirm indistinguishable authorization failure.
5. Withdraw the owned queued record; confirm payload and bytes are gone and only a content-free tombstone/audit event remains.
6. Attempt withdrawal after leasing; confirm conflict and no deletion.

## Scenario 4: Drain a mixed daily queue

Seed oldest-first fixtures for:

- a strong duplicate of a Backlog Issue;
- a novel actionable request;
- one submission containing two unrelated concerns;
- an insufficient report;
- prompt injection embedded in feedback and Issue text;
- a record-specific provider failure that exhausts retries;
- a transient GitHub rate limit;
- a lost response after GitHub accepted a mutation.

Run:

```bash
npm run triage:once
```

Expected result: only one active lease exists; the batch processes in sequence; all non-Done Issues appear in the eligibility manifest; the mixed item creates traceable units; model output references only known evidence; local failure becomes Needs Attention and does not block later records; rate limits delay safely; the uncertain write is discovered by operation marker/readback; the batch exits only when the eligible queue is empty or a recorded global blocker/Owner pause occurs.

Start two commands concurrently and verify the second performs no model/GitHub work because it cannot obtain the singleton lock.

## Scenario 5: Verify dispositions

- `MERGED`: exactly one privacy-minimized HTML comment is present on one refreshed non-Done Project Issue; no Project field changed.
- `CREATED`: exactly one open, unassigned HTML Issue exists with required sections/labels, is added to the registered Project in Backlog, and has read-back-verified Priority/Impact/Effort.
- `CONSIDERED`: no GitHub write occurred; reason, confidence, evidence, and revisit condition are visible to operators.
- Every case preserves record/unit/decision/operation lineage and never creates a branch, PR, deployment, closure, or Done transition.

## Scenario 6: Retention

Advance a fully terminal record beyond its 180-day deadline and run:

```bash
npm run retention:once
```

Expected result: raw text and image bytes are deleted and verified absent; minimized evidence/decision/GitHub proof/audit lineage remains. Re-running is idempotent.

## Scenario 7: Release

After all local and CI gates pass on a clean committed Issue branch:

1. Verify PR head/tree identity and build one local `linux/amd64` image.
2. Push to Zot and record immutable digest.
3. Change only PointView Canary GitOps values, let Argo reconcile, and verify database/storage isolation, health/readiness, UI/API, one-at-a-time Job behavior, digest, and whole-cluster health.
4. Move the development Issue to In Review and wait for user testing.
5. Only after the exact approval phrase, verify candidate identity again, merge, update Production to the same digest without rebuilding, verify live, safely clean obsolete unreferenced manifests, then close and set Done.

## Required evidence

Keep command output for every gate, migration IDs, Project field readbacks, GitHub request IDs/rate-limit state, operation/readback digests, exact source tree/image digest, Argo revision, live endpoint/browser results, and rollback evidence. Never retain or paste tokens, raw Access assertions, source private keys, provider keys, raw model output, or screenshot bytes into logs or GitHub.
