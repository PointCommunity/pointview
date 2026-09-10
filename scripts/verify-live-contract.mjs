export const expectedMigrationState = [
  ["0001", "pointview-initial-v1"],
  ["0002", "pointview-provider-connections-v1"],
  ["0003", "pointview-requeue-generations-v1"],
].map((entry) => entry.join("\t")).join("\n");

export function assertMigrationContract(appliedMigrations) {
  if (appliedMigrations !== expectedMigrationState) {
    throw new Error("database migration versions or digests do not match the running image");
  }
  return expectedMigrationState.split("\n").length;
}

export function assertRuntimeContract({ healthJson, sourceRevision, expectedSourceRevision, uid }) {
  const health = healthJson.health;
  const readiness = healthJson.ready;
  if (sourceRevision !== expectedSourceRevision || uid !== "10001") {
    throw new Error(`runtime identity mismatch: source=${sourceRevision} uid=${uid}`);
  }
  if (health?.status !== 200 || health?.body?.status !== "ok" || health?.cache !== "no-store" || !health?.csp) {
    throw new Error("health response is not safe and healthy");
  }
  if (readiness?.status !== 200 || readiness?.body?.ready !== true || healthJson.auth?.user !== 401 || healthJson.auth?.admin !== 401) {
    throw new Error("readiness or unauthenticated API boundary failed");
  }
  for (const name of ["database", "migrations", "storage", "source_registry", "github", "schedule"]) {
    if (!readiness.body.checks?.some((check) => check.name === name && check.ok === true)) {
      throw new Error(`readiness check ${name} is not ok`);
    }
  }
}

export function assertStorageContract(claims, otherClaims = []) {
  const attachments = claims.find((claim) => claim.metadata.name.includes("attachments"));
  const database = claims.find((claim) => claim.metadata.name.includes("postgres"));
  if (attachments?.status?.phase !== "Bound" || !attachments.spec?.accessModes?.includes("ReadWriteMany")) {
    throw new Error("private attachment PVC is not Bound RWX storage");
  }
  if (database?.status?.phase !== "Bound" || !database.spec?.accessModes?.includes("ReadWriteOnce")) {
    throw new Error("PostgreSQL PVC is not Bound RWO storage");
  }
  const otherUids = new Set(otherClaims.map((claim) => claim.metadata.uid));
  if (claims.some((claim) => otherUids.has(claim.metadata.uid))) throw new Error("release tracks share a PVC identity");
}
