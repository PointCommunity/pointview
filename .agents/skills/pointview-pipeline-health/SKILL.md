---
name: pointview-pipeline-health
description: "Perform a read-only health audit of the PointView Issue pipeline, Project metadata, PR linkage, CI state, candidate identity, and optionally Canary or Production runtime health."
---

# Audit PointView Pipeline Health

Read `AGENTS.md` and `.agents/pointview-pipeline-policy.html`.

1. Run `node .agents/skills/pointview-pipeline-health/scripts/audit-project.mjs` from the repository root.
2. Verify live Git status, branch/head, open Issues, open PRs, Project fields/cards, and required check state. Do not repair during a health audit.
3. When runtime health is requested and candidate identifiers are known, use the repo-owned `pointview-release-canary/scripts/verify-live.mjs` for the relevant track and supplement it with migration and workload logs, events, restart counts, internal health/readiness, and exact image identity. Do not require authenticated browser access for Canary or Production health audits.
4. Report pipeline, code/CI, Canary, Production, and homelab health separately. State exact drift and the owning skill needed to repair it.

Never change Project fields, Issues, PRs, Git, Zot, Gitea, Argo CD, or Kubernetes from this skill.
