#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const [, , track, sourceSha, imageDigest, homelabSha] = process.argv;
if (!track || !sourceSha || !imageDigest || !homelabSha || process.argv.length !== 6) {
  console.error("usage: verify-live.mjs <canary|production> <full-source-sha> <sha256-digest> <full-homelab-sha>");
  process.exit(2);
}
if (!new Set(["canary", "production"]).has(track)) {
  console.error("release track must be canary or production");
  process.exit(2);
}
if (!/^[0-9a-f]{40}$/.test(sourceSha) || !/^sha256:[0-9a-f]{64}$/.test(imageDigest) || !/^[0-9a-f]{40}$/.test(homelabSha)) {
  console.error("source SHA, digest, or homelab SHA format is invalid");
  process.exit(2);
}

const appName = track === "canary" ? "pointview-canary" : "pointview";
const namespace = appName;
const expectedImageSuffix = `@${imageDigest}`;
const run = (args) => execFileSync("kubectl", args, {
  encoding: "utf8",
  maxBuffer: 50 * 1024 * 1024,
  stdio: ["ignore", "pipe", "pipe"],
}).trim();
const json = (args) => JSON.parse(run(args));

function assertReadyContainer(container, label) {
  if (!container?.ready || container.restartCount !== 0 || !container.imageID?.endsWith(expectedImageSuffix)) {
    throw new Error(`${label} is not ready on ${imageDigest} with zero restarts`);
  }
}

try {
  const application = json(["get", "application", appName, "-n", "argocd", "-o", "json"]);
  const actualRevision = application.status?.sync?.revision;
  const sync = application.status?.sync?.status;
  const health = application.status?.health?.status;
  const operation = application.status?.operationState?.phase;
  if (actualRevision !== homelabSha || sync !== "Synced" || health !== "Healthy" || operation !== "Succeeded") {
    throw new Error(`Argo mismatch: revision=${actualRevision} sync=${sync} health=${health} operation=${operation}`);
  }

  const webPods = json(["get", "pods", "-n", namespace, "-l", "app.kubernetes.io/controller=main", "-o", "json"]).items;
  const postgresPods = json(["get", "pods", "-n", namespace, "-l", "app.kubernetes.io/controller=postgres", "-o", "json"]).items;
  if (webPods.length !== 1 || postgresPods.length !== 1) {
    throw new Error(`expected one web pod and one PostgreSQL pod; found web=${webPods.length} postgres=${postgresPods.length}`);
  }
  const webPod = webPods[0];
  const postgresPod = postgresPods[0];
  const initContainers = new Map((webPod.status?.initContainerStatuses || []).map((container) => [container.name, container]));
  if (initContainers.get("migrate")?.state?.terminated?.exitCode !== 0) {
    throw new Error("migration init container did not complete successfully");
  }
  const webContainer = (webPod.status?.containerStatuses || []).find((container) => container.name === "web");
  assertReadyContainer(webContainer, "web container");
  const postgresReady = postgresPod.status?.phase === "Running"
    && (postgresPod.status?.containerStatuses || []).every((container) => container.ready && container.restartCount === 0);
  if (webPod.status?.phase !== "Running" || !postgresReady) throw new Error("web or PostgreSQL workload is not healthy");

  const runtimeSource = run(["exec", "-n", namespace, webPod.metadata.name, "-c", "web", "--", "printenv", "SOURCE_REVISION"]);
  const runtimeUid = run(["exec", "-n", namespace, webPod.metadata.name, "-c", "web", "--", "id", "-u"]);
  if (runtimeSource !== sourceSha || runtimeUid !== "1000") {
    throw new Error(`runtime identity mismatch: source=${runtimeSource} uid=${runtimeUid}`);
  }

  const healthPayload = run(["exec", "-n", namespace, webPod.metadata.name, "-c", "web", "--", "node", "--input-type=module", "-e",
    'const out={}; for (const p of ["/api/health","/api/ready"]) { const r=await fetch(`http://127.0.0.1:3000${p}`); if (!r.ok) throw new Error(`${p} ${r.status}`); out[p]=await r.json(); } console.log(JSON.stringify(out));']);
  const healthJson = JSON.parse(healthPayload);
  const ready = healthJson["/api/ready"];
  if (healthJson["/api/health"]?.status !== "ok" || ready?.status !== "ready" || ready?.sourceRevision !== sourceSha) {
    throw new Error(`health/readiness payload mismatch: ${healthPayload}`);
  }
  for (const name of ["database", "migrations", "storage", "sourceRegistry", "github"]) {
    if (ready.checks?.[name] !== "ok") throw new Error(`readiness check ${name} is not ok`);
  }

  const expectedMigrations = run(["exec", "-n", namespace, webPod.metadata.name, "-c", "web", "--", "node", "--input-type=module", "-e",
    'import {createHash} from "node:crypto"; import {readdirSync,readFileSync} from "node:fs"; for (const name of readdirSync("migrations").filter((v)=>/^\\d+.*\\.sql$/.test(v)).sort()) console.log(`${name}\\t${createHash("sha256").update(readFileSync(`migrations/${name}`)).digest("hex")}`);']);
  const appliedMigrations = run(["exec", "-n", namespace, postgresPod.metadata.name, "-c", "main", "--", "psql", "-U", "pointview", "-d", "pointview", "-At", "-F", "\t", "-c", "SELECT name,digest FROM schema_migrations ORDER BY name"]);
  if (expectedMigrations !== appliedMigrations) throw new Error("database migration names or digests do not match the running image");

  const cronJobs = json(["get", "cronjobs", "-n", namespace, "-l", `app.kubernetes.io/instance=${appName}`, "-o", "json"]).items;
  const triage = cronJobs.find((job) => job.metadata.name.includes("triage"));
  const retention = cronJobs.find((job) => job.metadata.name.includes("retention"));
  if (!triage || !retention) throw new Error("triage and retention CronJobs must both exist");
  if (triage.spec?.concurrencyPolicy !== "Forbid" || triage.spec?.timeZone !== "America/Chicago") {
    throw new Error("triage CronJob must use concurrencyPolicy Forbid and America/Chicago");
  }
  for (const job of [triage, retention]) {
    const images = (job.spec?.jobTemplate?.spec?.template?.spec?.containers || []).map((container) => container.image);
    if (images.length !== 1 || !images[0].endsWith(`${sourceSha.slice(0, 7)}@${imageDigest}`)) {
      throw new Error(`${job.metadata.name} does not reference the approved image`);
    }
  }

  const claims = json(["get", "pvc", "-n", namespace, "-o", "json"]).items;
  if (!claims.some((claim) => claim.metadata.name.includes("attachments") && claim.status?.phase === "Bound")) {
    throw new Error("private attachment PVC is not Bound");
  }

  const warnings = json(["get", "events", "-n", namespace, "--field-selector", "type=Warning", "-o", "json"]).items.length;
  const nodes = json(["get", "nodes", "-o", "json"]).items;
  const badNodes = nodes.filter((node) => {
    const conditions = node.status?.conditions || [];
    return conditions.find((condition) => condition.type === "Ready")?.status !== "True"
      || conditions.some((condition) => condition.type.endsWith("Pressure") && condition.status === "True");
  });
  const applications = json(["get", "applications", "-n", "argocd", "-o", "json"]).items;
  const badApps = applications.filter((app) => app.status?.sync?.status !== "Synced" || app.status?.health?.status !== "Healthy");
  const allPods = json(["get", "pods", "-A", "-o", "json"]).items;
  const badPods = allPods.filter((candidate) => {
    if (!["Running", "Succeeded"].includes(candidate.status?.phase)) return true;
    return candidate.status?.phase === "Running" && (candidate.status?.containerStatuses || []).some((container) => !container.ready);
  });
  const ceph = run(["exec", "-n", "rook-ceph", "deploy/rook-ceph-tools", "--", "ceph", "health"]);
  if (warnings || badNodes.length || badApps.length || badPods.length || ceph !== "HEALTH_OK") {
    throw new Error(`all-green failed: warnings=${warnings} nodes=${badNodes.length} apps=${badApps.length} pods=${badPods.length} ceph=${ceph}`);
  }

  console.log(`track=${track}`);
  console.log(`source_sha=${runtimeSource}`);
  console.log(`homelab_revision=${actualRevision}`);
  console.log(`web_pod=${webPod.metadata.name}`);
  console.log(`image_digest=${imageDigest}`);
  console.log(`migrations=${expectedMigrations.split("\n").filter(Boolean).length}`);
  console.log(`cronjobs=${triage.metadata.name},${retention.metadata.name}`);
  console.log("health=green");
} catch (error) {
  console.error(error.stderr?.toString().trim() || error.message);
  process.exit(1);
}
