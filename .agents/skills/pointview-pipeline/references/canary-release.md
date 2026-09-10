# PointView Canary Release

## Identity and preflight

The candidate is the tuple of the active Issue, open PointView pull request, exact head SHA/tree, immutable Zot digest, verified bjw-s app-template generation/render, and homelab Canary commit. Read all values live; never reuse a prior run's identifiers.

Before mutation, verify the PointView branch is clean, GitHub Quality and AMD64 checks are green for its exact head, the homelab canonical checkout and Gitea `origin/master`, current Canary image/chart pins, current Argo revision, PVC/PV identities, nodes, pods, applications, and Ceph health. Use an isolated homelab worktree from current Gitea `origin/master`.

## Package and registry

Export the exact PointView head with `git archive` into a temporary directory and build it locally using Podman with `--platform linux/amd64` and the `POINTVIEW_SOURCE_REVISION` build argument set to the full source SHA. Tag Zot with the seven-character SHA. Push, then query the registry or pull by digest to resolve and prove the immutable digest. Do not rely on a mutable local image ID.

Smoke the published artifact with disposable PostgreSQL and private attachment storage. Verify all migrations, `/api/health`, `/api/ready`, non-root UID, source revision, the writes-disabled triage command, the retention command, security headers, and clean teardown. No source-app private key, GitHub token, or provider key may appear in the image or smoke-test output.

## GitOps and live verification

Compare the pinned app-template version to the latest stable official bjw-s chart release and read its upgrade notes. Update only Canary's dependency files when needed, inspect the old/new rendered manifests, and reject any unexplained namespace, controller, StatefulSet, persistence, PVC, storage-class, database, secret, ingress, or release-identity change. Change `app-template.controllers.main.initContainers.migrate.image` through the shared YAML anchor in `apps/pointview-canary/values.yaml`: update both tag and digest. Do not modify Production.

Run the chart's dependency update, `helm lint`, and `helm template`; inspect the rendered migration, web, triage CronJob, and retention CronJob images. Commit only the intended Canary values file and push current Gitea `master`.

Refresh and wait for `pointview-canary`. Verify:

- Argo is Synced and Healthy at the expected homelab revision.
- Migration completed and PostgreSQL migration names/digests exactly match the running image.
- Web runs the exact registry digest as UID 10001 with zero restarts; triage and retention Job templates reference that same digest.
- Liveness and readiness pass; readiness confirms migrations, database, attachment storage, source registry, and configured GitHub integration without making a model call; runtime `POINTVIEW_SOURCE_REVISION` matches the candidate.
- The triage CronJob is daily, uses `concurrencyPolicy: Forbid` and `America/Chicago`, and a controlled empty run performs no model or GitHub mutation. Retention is separately scheduled and cannot acquire a triage lease.
- Logs and recent events show no unexpected errors or warnings.
- Canary ingress, TLS, DNS, and unauthenticated Cloudflare Access redirect behave correctly.
- Every node is Ready, every Argo application is Synced and Healthy, unexpected non-running pods are absent, and Ceph is `HEALTH_OK`.

## User handoff

Keep the PointView pull request open. Record the source SHA, digest, homelab revision, automated results, and live health in its description. Provide a manual checklist derived from the actual diff plus baseline sign-in, role authorization, evidence grounding, mobile layout, and regression checks.

Production stays untouched until the user approves this exact Canary candidate.
