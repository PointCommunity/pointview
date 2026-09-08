#!/usr/bin/env node

import path from "node:path";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";

const [, , track, sourceSha, imageDigest, explicitHomelabRepo] = process.argv;
if (!track || !sourceSha || !imageDigest || process.argv.length > 7) {
  console.error("usage: check-candidate.mjs <canary|production> <full-source-sha> <sha256-digest> [homelab-repo]");
  process.exit(2);
}
if (!new Set(["canary", "production"]).has(track)) {
  console.error("release track must be canary or production");
  process.exit(2);
}
if (!/^[0-9a-f]{40}$/.test(sourceSha)) {
  console.error("source SHA must be 40 lowercase hexadecimal characters");
  process.exit(2);
}
if (!/^sha256:[0-9a-f]{64}$/.test(imageDigest)) {
  console.error("image digest must be a complete sha256 digest");
  process.exit(2);
}

const homelabRepo = path.resolve(explicitHomelabRepo || "/Users/chris/Documents/Github/homelab");
const chartName = track === "canary" ? "pointview-canary" : "pointview";
const chartDir = path.join(homelabRepo, "apps", chartName);
const run = (command, args) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "pointview-candidate-"));
const isolatedChartDir = path.join(temporaryRoot, chartName);

try {
  cpSync(chartDir, isolatedChartDir, { recursive: true });
  run("helm", ["dependency", "build", isolatedChartDir]);
  run("helm", ["lint", isolatedChartDir]);
  const rendered = run("helm", ["template", chartName, isolatedChartDir, "--namespace", chartName]);
  const expected = `10.0.20.11:32309/pointview:${sourceSha.slice(0, 7)}@${imageDigest}`;
  const imageLines = rendered.split("\n").filter((line) => line.trim().replaceAll('"', "") === `image: ${expected}`);
  if (imageLines.length !== 4) throw new Error(`expected 4 rendered image references for ${expected}; found ${imageLines.length}`);
  console.log(`track=${track}`);
  console.log(`source_sha=${sourceSha}`);
  console.log(`image_digest=${imageDigest}`);
  console.log(`rendered_image_count=${imageLines.length}`);
} catch (error) {
  console.error(error.stderr?.toString().trim() || error.message);
  process.exitCode = 1;
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
