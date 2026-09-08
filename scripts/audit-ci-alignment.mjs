#!/usr/bin/env node

import fs from "node:fs";

const checks = [
  [".github/workflows/quality.yml", ["name: Quality", "verify:", "postgres:", "browser:", "npm ci", "npm run check", "npm run security:check", "npm run test:integration", "npm run test:e2e"]],
  [".github/workflows/container.yml", ["name: Container", "amd64:", "linux/amd64", "pointview:ci", "sbom.spdx.json", "severity: HIGH,CRITICAL"]],
];
const errors = [];

for (const [path, needles] of checks) {
  if (!fs.existsSync(path)) {
    errors.push(`missing ${path}`);
    continue;
  }
  const content = fs.readFileSync(path, "utf8");
  for (const needle of needles) {
    if (!content.includes(needle)) errors.push(`${path} is missing ${JSON.stringify(needle)}`);
  }
}

const workflows = checks
  .map(([file]) => fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "")
  .join("\n");
for (const forbidden of ["kubectl ", "argocd ", "docker push", "build-push-action@master"]) {
  if (workflows.includes(forbidden)) errors.push(`pull-request workflows contain forbidden deployment behavior ${JSON.stringify(forbidden)}`);
}

if (errors.length) {
  console.error(`PointView CI alignment failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("PointView CI alignment OK: source, database, browser, AMD64 build, SBOM, scan, and no-deploy gates are declared.");
