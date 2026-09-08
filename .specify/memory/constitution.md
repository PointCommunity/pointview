# PointView Constitution

## Core Principles

### I. Spec-first, evidence-first development

Every material capability begins with a reviewed specification. Product and implementation decisions must be traceable to repository evidence, current primary documentation, or an explicitly recorded assumption.

### II. Deterministic authority around agent judgment

Models may research, compare, classify, split, summarize, and recommend. Deterministic application code owns authentication, authorization, queue leasing, input/output validation, GitHub mutations, idempotency, rate limiting, retries, and audit records. Models never receive database, GitHub, provider, filesystem, or cluster credentials.

### III. Privacy and untrusted-input containment

Feedback, screenshots, linked pages, repository text, Issue content, and web content are untrusted data. PointView minimizes personal data, stores raw material behind PointView access controls, publishes only privacy-reviewed summaries to GitHub, validates uploaded files in depth, and never executes embedded instructions or content.

### IV. One feedback item, one controlled decision at a time

One daily scheduled batch drains the eligible queue sequentially. The worker leases and processes exactly one raw feedback record at a time and never runs concurrent triage decisions. A record may be split into multiple independently traceable feedback units, but every unit must end in an explicit, auditable disposition: merged into an eligible Issue, created as a new Issue, or considered with no GitHub mutation.

### V. Governed Issue and release lifecycles

PointView adopts PointGuide's Project fields, one-active-development-Issue rule, agent-owned Project movement, exact-candidate Canary verification, explicit Production approval, same-digest promotion, and post-release cleanup. Automated feedback triage may add or enrich inactive or active target Issues without taking a development slot or changing target development status. Only the human Project Manager triggers an app's development pipeline; triage never starts implementation work.

### VI. Accessible, mobile-first quality

PointView is dark-mode-first and usable at 320 CSS pixels, 200% zoom, by keyboard, touch, and assistive technology. Controls have visible focus, reduced-motion behavior, native semantics, and at least 44 by 44 CSS-pixel targets. Core logic maintains at least 80% line coverage.

## Mandatory Gates

- Complete focused tests, type checking, lint, unit/integration/contract coverage, production build, security checks, upload tests, responsive browser tests, and migration rehearsal before Canary.
- Validate the exact GitHub Project schema and every GitHub mutation by readback.
- Build one clean committed `linux/amd64` image locally, publish it to Zot, deploy Canary through Gitea-backed homelab GitOps, and verify the exact digest and whole-cluster health.
- Require `Approved to merge and deploy production` for the recorded candidate before merge or Production mutation; promote the identical digest without rebuilding.
- Preserve user-owned work, live data identity, rollback evidence, and secrets throughout.

## Governance

Amendments require explicit stakeholder discussion, a semantic version increment, rationale, and a consistency audit across `AGENTS.md`, repository skills, CI, specs, and release policy. No implementation phase may waive a failed mandatory gate.

## Version History

| Version | Date | Changes |
| --- | --- | --- |
| 1.0.0 | 2026-09-07 | Initial PointView product and delivery principles. |

**Version**: 1.0.0 | **Ratified**: 2026-09-07 | **Last Amended**: 2026-09-07
