---
name: pointview-work-issue
description: "Select or implement one PointView GitHub Issue while enforcing the single-active-Issue pipeline. Use for Work Issue, Work Issue #N, starting Backlog work, or continuing the active implementation."
---

# Work a PointView Issue

Read `AGENTS.md`, `.agents/pointview-pipeline-policy.html`, the live Project, all active cards, the Issue, open PRs, Git state, and relevant code before acting.

## Selection gate

- If more than one card is active, stop and report the conflict without changing code or metadata.
- If an active Issue exists, work only that Issue. Refuse a different requested Issue unless the PM first resolves the active card.
- If no Issue number and no active card exist, rank the Backlog and recommend the top three with impact, effort, risk, and rationale. Wait for PM selection.
- A requested Issue must be open and in Backlog unless it is the existing active Issue. On Hold may resume only when the PM explicitly requests it.
- The PM's selection or resume request is the decision gate. The agent performs the Project transition and readback; never ask the PM to move the card.

## Start and implement

1. As the agent-owned Project transition, move the selected Issue to In Progress, assign only `brimdor`, and immediately read back Status, assignment, metadata, and the one-active-Issue count before editing code.
2. Start from current `origin/main` on `issue/<number>-<short-slug>`. Preserve user-owned work and fail closed if branch creation would mix unrelated changes.
3. Diagnose before editing. For Next.js code, read the relevant installed guide under `node_modules/next/dist/docs/`.
4. Implement the smallest coherent solution with focused tests. Keep Issue scope and metadata current if evidence changes effort, impact, labels, or acceptance criteria.
5. Run focused checks while iterating, then the complete gates required by `AGENTS.md`.
6. Commit intended files, push the feature branch, and create or update a PR targeting `main`. The PR body must contain `Refs #<number>` and must not contain an auto-closing keyword.
7. Hand off directly to `pointview-review-issue`; do not move to In Review merely because a PR exists.

If the PM explicitly requests a pause, the agent moves the card to On Hold, preserves the Issue/branch/PR evidence, verifies that the active slot is released, and reports the resulting state. On resumption, the agent performs the In Progress transition after rechecking the slot.
