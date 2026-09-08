---
name: pointview-review-issue
description: "Perform complete agent QA for the active PointView Issue, remediate all findings, deploy the exact candidate to Canary, and prepare the PM review checklist."
---

# Review a PointView Issue

Read `AGENTS.md`, `.agents/pointview-pipeline-policy.html`, the active Issue, PR diff and history, acceptance criteria, current Canary state, and relevant test guidance.

1. Require the Issue to be the sole active card in In Progress. Keep it In Progress throughout agent QA and Canary preparation.
2. Review correctness, regressions, security, privacy, authorization, error paths, data migration, operations, accessibility, responsive behavior, and repository instructions in proportion to the diff.
3. Run focused tests, `npm run check`, `git diff --check`, migration rehearsal when applicable, and relevant Playwright coverage. Use Browser hands-on testing against a local instance for every affected flow at relevant desktop, tablet, and phone widths. This local browser QA is the required application-behavior gate.
4. Remediate every finding on the same Issue branch. Repeat the entire affected review surface until there are zero unresolved findings.
5. Ensure the PR is current, references the Issue without auto-close syntax, and the GitHub `Quality / verify` and `Container / amd64` checks succeed for the exact committed head.
6. Invoke `pointview-release-canary`. Do not request PM review until the exact candidate and whole homelab are verified green.
7. As the agent-owned Project transition, move the Issue to In Review, immediately read back the card and sole-active count, and provide a concise checklist derived from the actual diff plus baseline smoke and regression checks. Include PR head, Git tree, Zot digest, app-template version, homelab Canary commit, CI runs, and Canary URL. Never ask the PM to move the card.
8. PM findings are blocking: the agent moves the card to In Progress and verifies it before remediation, creates a new candidate, and repeats. Silence or an earlier approval is not approval.

Wait for the exact phrase `Approved to merge and deploy production` for the current candidate. That phrase authorizes `pointview-close-issue`.
