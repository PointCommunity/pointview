---
name: pointview-close-issue
description: "Close an approved PointView Issue by validating the exact Canary candidate, squash-merging its PR, promoting the same digest to Production, verifying all-green, and completing Project metadata."
---

# Close a PointView Issue

Read `AGENTS.md`, `.agents/pointview-pipeline-policy.html`, the sole active Issue, PR, approval message, candidate evidence, GitHub checks, and live Canary state.

1. Require Status In Review and the exact phrase `Approved to merge and deploy production` for the current recorded head/tree, Zot digest, and Canary commit. Any mismatch or later change invalidates approval.
2. Confirm the PR targets `main`, contains `Refs #<number>` without auto-close syntax, has successful required checks, no unresolved review threads, and is mergeable. Make the branch current with `main` only through a reviewed change that is redeployed to Canary.
3. Record the approved PR head tree, then squash-merge. Confirm the resulting `main` commit tree exactly equals the approved tree. If it differs, stop; do not deploy Production.
4. Immediately invoke `pointview-release-production` with the approved source head, tree, digest, app-template generation, merge commit, and Canary homelab commit. Production must not rebuild the image, and no second approval or intermediate handoff is permitted.
5. If Production fails, keep the Issue open and In Review. Perform the release skill's authorized non-destructive GitOps rollback; use a follow-up branch/PR on the same active Issue when source remediation is required.
6. Only after Production and the whole cluster are green, the Production skill has purged obsolete unreferenced PointView image manifests from Zot, and the retained Production digest is still pullable: update PR and Issue evidence, close the Issue, perform the agent-owned Project transition to Done, immediately read back the closed Issue and card, verify zero active Issues, and delete the merged feature branch when safe. Do not wait for Zot's delayed background blob garbage collection or repeat the full health audit solely because manifest cleanup occurred. Never ask the PM to move the card.

A merged PR is not completion. Never close the Issue before Production verification.
