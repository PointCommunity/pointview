---
name: pointview-release-canary
description: "Build the exact approved-for-review PointView PR head once, upload its immutable image to Zot, deploy Canary through homelab GitOps, and verify application and cluster health."
---

# Release PointView Canary

Read `AGENTS.md`, `.agents/pointview-pipeline-policy.html`, `.agents/skills/pointview-pipeline/references/canary-release.md`, the live PointView and homelab instructions, and the selected Issue/PR. Canary deployment is authorized only as part of agent review for the sole active Issue.

1. Require a clean committed PR head, an open PR targeting `main`, Status In Progress, complete local gates, and successful `Quality / verify` for the exact head.
2. Build from an exact archive of that PR head in a fresh directory on the local development workstation, never from a dirty worktree and never on a Kubernetes node. Target `linux/amd64`, the cluster workload platform, using the local container runtime. Use the repository Dockerfile, tag `10.0.20.11:32309/pointview:<seven-character-head>`, push to Zot with the required internal-registry transport, and resolve the registry `Docker-Content-Digest`. Do not infer the digest from a local image ID.
3. In an isolated worktree from current Gitea `origin/master`, verify the current Canary PVCs and workload identity. Compare app-template with the latest stable version in the official bjw-s chart index, read its release/upgrade notes, update Canary's chart dependency when needed, and inspect the before/after render. Do not change a namespace, controller, StatefulSet, persistence key, PVC, storage class, secret, database, ingress, or release identity.
4. Update only the reviewed Canary chart dependency files when required and the shared migrate, web, triage CronJob, and retention CronJob image pin in `apps/pointview-canary/values.yaml`. Run Helm dependency update, lint/render, semantic render comparison, targeted pre-commit, `git diff --check`, `node .agents/skills/pointview-release-canary/scripts/check-chart-version.mjs canary <homelab-repo>`, and `node .agents/skills/pointview-release-canary/scripts/check-candidate.mjs canary <full-source-sha> <digest> <homelab-repo>`.
5. Commit only the Canary values file, push Gitea `master`, refresh Argo CD, and wait for `pointview-canary` to become Synced and Healthy at that exact homelab revision.
6. Run `node scripts/verify-live.mjs canary <source-sha> <digest> <homelab-sha>`. Inspect migration, web, triage/retention Job, attachment-storage, and PostgreSQL logs; readiness evidence; events; restart counts; exact digest; PVC identity; ingress/TLS/DNS; Cloudflare Access; and the whole cluster. Authenticated Canary browser testing is optional when supported access already exists; otherwise skip it without blocking release, requesting credentials, or weakening authentication because local browser QA already proves application behavior.
7. Update the PR with Issue, exact head/tree, digest, app-template version and render evidence, homelab commit, CI, tests, health evidence, and the Production gate. The candidate is Issue + PR + head/tree + digest + chart generation + Canary commit.
8. Clean only isolated databases, tunnels, servers, Browser tabs, temporary manifests, kubeconfigs, and exact remote build directories created by this run.

Any source, dependency, migration, image, chart, or rendered configuration change creates a new candidate. Never edit Production or merge the PR from this skill.
