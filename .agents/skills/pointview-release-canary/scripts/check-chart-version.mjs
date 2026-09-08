#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

const [, , track, explicitHomelabRepo] = process.argv;
if (!new Set(["canary", "production"]).has(track) || process.argv.length > 4) {
  console.error("usage: check-chart-version.mjs <canary|production> [homelab-repo]");
  process.exit(2);
}

const homelabRepo = path.resolve(explicitHomelabRepo || "/Users/chris/Documents/Github/homelab");
const chartName = track === "canary" ? "pointview-canary" : "pointview";
const chartPath = path.join(homelabRepo, "apps", chartName, "Chart.yaml");
const chart = YAML.parse(readFileSync(chartPath, "utf8"));
const dependency = chart.dependencies?.find((candidate) => candidate.name === "app-template");
if (!dependency || dependency.repository !== "https://bjw-s-labs.github.io/helm-charts/") {
  console.error(`${chartPath} must use the official bjw-s app-template repository`);
  process.exit(1);
}

const response = await fetch("https://bjw-s-labs.github.io/helm-charts/index.yaml", { signal: AbortSignal.timeout(15_000) });
if (!response.ok) throw new Error(`official bjw-s chart index returned ${response.status}`);
const index = YAML.parse(await response.text());
const stableVersions = (index.entries?.["app-template"] || [])
  .map((entry) => entry.version)
  .filter((version) => /^\d+\.\d+\.\d+$/.test(version));
const compare = (left, right) => {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
};
const latest = stableVersions.sort(compare).at(-1);
if (!latest) throw new Error("official bjw-s chart index contains no stable app-template release");
if (dependency.version !== latest) {
  console.error(`track=${track} pinned=${dependency.version} latest=${latest}`);
  process.exit(1);
}

console.log(`track=${track}`);
console.log(`app_template=${dependency.version}`);
console.log("chart_version=current");
