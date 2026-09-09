#!/usr/bin/env node

import {
  assertMigrationContract,
  assertRuntimeContract,
  assertStorageContract,
  expectedMigrationState,
} from "./verify-live-contract.mjs";

const checks = ["database", "migrations", "storage", "source_registry", "github", "schedule"]
  .map((name) => ({ name, ok: true }));
const healthJson = {
  health: { status: 200, body: { status: "ok" }, cache: "no-store", csp: "default-src 'self'" },
  ready: { status: 200, body: { ready: true, checks } },
  auth: { user: 401, admin: 401 },
};
const claims = [
  { metadata: { name: "pointview-attachments", uid: "attachments-a" }, status: { phase: "Bound" }, spec: { accessModes: ["ReadWriteMany"] } },
  { metadata: { name: "pointview-postgres", uid: "postgres-a" }, status: { phase: "Bound" }, spec: { accessModes: ["ReadWriteOnce"] } },
];

assertRuntimeContract({ healthJson, sourceRevision: "a".repeat(40), expectedSourceRevision: "a".repeat(40), uid: "10001" });
assertStorageContract(claims, [{ metadata: { uid: "production-different" } }]);
assertMigrationContract(expectedMigrationState);

let plantedFailures = 0;
for (const operation of [
  () => assertRuntimeContract({ healthJson, sourceRevision: "b".repeat(40), expectedSourceRevision: "a".repeat(40), uid: "10001" }),
  () => assertRuntimeContract({ healthJson, sourceRevision: "a".repeat(40), expectedSourceRevision: "a".repeat(40), uid: "1000" }),
  () => assertStorageContract(claims, [{ metadata: { uid: "postgres-a" } }]),
  () => assertMigrationContract("0001\tpointview-initial-v1"),
  () => assertMigrationContract(`${expectedMigrationState}\n0003\tunexpected`),
]) {
  try { operation(); } catch { plantedFailures += 1; }
}
if (plantedFailures !== 5) throw new Error(`expected five planted verifier failures; observed ${plantedFailures}`);

console.log("PointView live-verifier fixture OK: healthy state passed and stale source, wrong UID, shared PVC, and migration drift were rejected.");
