#!/usr/bin/env node

import fs from "node:fs";

const checks = [
  [".github/workflows/quality.yml", ["name: Quality", "verify:", "npm ci", "npm run check"]],
  [".github/workflows/container.yml", ["name: Container", "amd64:", "linux/amd64"]],
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

if (errors.length) {
  console.error(`PointView CI alignment failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("PointView CI alignment OK: Quality / verify and Container / amd64 are declared.");
