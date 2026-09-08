# Implementation Plan: PointView Feedback Triage Platform

## Overview

The authoritative implementation plan is [`specs/001-feedback-triage-platform/plan.md`](../specs/001-feedback-triage-platform/plan.md). PointView is a private Next.js/PostgreSQL application with signed source provenance, safe private screenshots, daily singleton queue drainage, deterministic evidence/GitHub adapters, a credentialless model decision boundary, 180-day raw retention, and the PointGuide exact-candidate release lifecycle.

## Architecture decisions

- Source-app backends sign short-lived single-use EdDSA launch assertions; browsers cannot select or forge routing.
- Kubernetes starts a daily Job, while PostgreSQL singleton/lease invariants guarantee one-at-a-time oldest-first drainage until empty.
- Deterministic collectors and validators surround a strict-schema model call; the model has web search but no credentials or mutation tools.
- A private least-privilege GitHub App applies only merge comments or new Backlog Issues and proves idempotency through markers/readback.
- Raw feedback/screenshots are erased 180 days after terminal triage; minimized decisions, evidence, operation proofs, and audit lineage remain.
- PointGuide repository skills, Project fields, CI gates, Zot/Argo Canary, and same-digest Production promotion are adapted; knowledge/training are omitted.

## Phases and checkpoints

1. Governed repository/Project bootstrap — verify private remote, fields, labels, Issue #1, and branch.
2. Foundation — verify clean install, migrations, auth, audit, and accessible shell.
3. Trusted intake — verify signed launch, safe upload, own-record access, and withdrawal.
4. Sequential decisions — verify oldest-first singleton drain, evidence manifests, and strict outputs with mutations disabled.
5. GitHub outcomes — verify merge/create/consider twice against isolated resources without duplicates or status changes.
6. Operations/retention — verify role controls, recovery, observability, and 180-day deletion.
7. Canary release — verify the exact source/tree/image/digest/GitOps chain and live behavior.
8. Human risk review — Production remains gated on the exact approval phrase and same digest.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Unsafe model judgment | High | No credentials/tools, strict evidence/schema/routing/privacy validation, risk review |
| Duplicate GitHub work | High | Stable markers, operation ledger, search-before-write, readback |
| Sensitive screenshot exposure | High | Explicit upload, safe normalization, private ACL, 180-day deletion |
| Cron overlap or poisoned record | High | Scheduler `Forbid`, DB singleton, lease recovery, per-record Needs Attention isolation |
| Release drift | High | Clean exact head, immutable Zot digest, same-digest promotion, readback |

## Open questions

None. Operator-tunable defaults do not alter the approved product behavior. Implementation waits for human approval of the plan and exact bootstrap Issue draft.
