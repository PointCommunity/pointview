#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../../..");
const pipelineSkillNames = [
  "pointview-pipeline",
  "pointview-create-issue",
  "pointview-audit-issues",
  "pointview-work-issue",
  "pointview-review-issue",
  "pointview-release-canary",
  "pointview-close-issue",
  "pointview-release-production",
  "pointview-pipeline-health",
  "pointview-maintain-skills",
];
const sharedDesignSkillNames = [
  "awesome-design",
  "design-taste-frontend",
  "image-to-code",
  "playwright-cli",
  "web-design-guidelines",
];
const skillNames = [...pipelineSkillNames, ...sharedDesignSkillNames];
const errors = [];

function read(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    errors.push(`missing ${relativePath}`);
    return "";
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function requireText(content, needle, owner) {
  if (!content.includes(needle)) errors.push(`${owner} does not contain ${JSON.stringify(needle)}`);
}

function rejectText(content, needle, owner) {
  if (content.includes(needle)) errors.push(`${owner} must not contain ${JSON.stringify(needle)}`);
}

const agents = read("AGENTS.md");
const claude = read("CLAUDE.md").trim();
const gemini = read("GEMINI.md").trim();
const policy = read(".agents/pointview-pipeline-policy.html");
const packageJson = JSON.parse(read("package.json") || "{}");

if (claude !== "@AGENTS.md") errors.push("CLAUDE.md must contain only @AGENTS.md");
if (gemini !== "@./AGENTS.md") errors.push("GEMINI.md must contain only @./AGENTS.md");
requireText(policy, "color-scheme: dark", ".agents/pointview-pipeline-policy.html");
requireText(policy, "Approved to merge and deploy production", ".agents/pointview-pipeline-policy.html");
requireText(policy, "without rebuilding", ".agents/pointview-pipeline-policy.html");
requireText(agents, "Exactly one Issue may be active", "AGENTS.md");
requireText(agents, "Production never rebuilds an approved candidate", "AGENTS.md");
requireText(agents, "image cleanup is mandatory", "AGENTS.md");
requireText(agents, "Never ask the PM to move a Project card", "AGENTS.md");
requireText(agents, "GitHub Project: organization-owned private Project `PointView`, number `4`", "AGENTS.md");
requireText(agents, "No second approval or pause occurs", "AGENTS.md");
requireText(policy, "Agent-owned Project movement", ".agents/pointview-pipeline-policy.html");
requireText(policy, "The PM never has to drag a card", ".agents/pointview-pipeline-policy.html");
requireText(policy, "purges obsolete unreferenced PointView image manifests from Zot", ".agents/pointview-pipeline-policy.html");
requireText(policy, "does not wait for Zot's delayed background garbage collection", ".agents/pointview-pipeline-policy.html");
requireText(policy, "retained Production digest remains pullable", ".agents/pointview-pipeline-policy.html");
requireText(policy, "latest stable version published by the official bjw-s chart repository", ".agents/pointview-pipeline-policy.html");
requireText(policy, "Homelab data is critical", ".agents/pointview-pipeline-policy.html");

const canaryRelease = read(".agents/skills/pointview-release-canary/SKILL.md");
const productionRelease = read(".agents/skills/pointview-release-production/SKILL.md");
requireText(canaryRelease, "local development workstation", ".agents/skills/pointview-release-canary/SKILL.md");
requireText(canaryRelease, "never on a Kubernetes node", ".agents/skills/pointview-release-canary/SKILL.md");
requireText(canaryRelease, "check-chart-version.mjs", ".agents/skills/pointview-release-canary/SKILL.md");
requireText(productionRelease, "Purge obsolete unreferenced PointView image manifests from Zot", ".agents/skills/pointview-release-production/SKILL.md");
requireText(productionRelease, "restorable database backup or snapshot", ".agents/skills/pointview-release-production/SKILL.md");
for (const [owner, content] of [
  ["AGENTS.md", agents],
  [".agents/pointview-pipeline-policy.html", policy],
  [".agents/skills/pointview-release-canary/SKILL.md", canaryRelease],
  [".agents/skills/pointview-release-production/SKILL.md", productionRelease],
]) {
  rejectText(content, "cyndaquil", owner);
  rejectText(content, "Versa", owner);
  rejectText(content, "Zuriel-Labs", owner);
  rejectText(content, "PointAudio", owner);
  rejectText(content, "corpus", owner);
}

const transitionContracts = {
  "pointview-create-issue": "never ask the PM to add or move the card",
  "pointview-work-issue": "agent-owned Project transition",
  "pointview-review-issue": "agent-owned Project transition",
  "pointview-close-issue": "agent-owned Project transition",
};
for (const [skillName, contract] of Object.entries(transitionContracts)) {
  requireText(read(`.agents/skills/${skillName}/SKILL.md`), contract, `.agents/skills/${skillName}/SKILL.md`);
}

for (const skillName of pipelineSkillNames) {
  requireText(agents, `\`${skillName}\``, "AGENTS.md");
}
for (const skillName of sharedDesignSkillNames) {
  requireText(agents, `\`${skillName}\``, "AGENTS.md");
}

for (const skillName of skillNames) {
  const canonicalRelative = `.agents/skills/${skillName}/SKILL.md`;
  const canonical = read(canonicalRelative);
  const frontmatter = canonical.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter) {
    errors.push(`${canonicalRelative} has invalid frontmatter`);
  } else {
    requireText(frontmatter[1], `name: ${skillName}`, canonicalRelative);
    if (!/^description:\s*.+$/m.test(frontmatter[1])) errors.push(`${canonicalRelative} has no description`);
  }
  const adapterRelative = `.claude/skills/${skillName}/SKILL.md`;
  const adapterPath = path.join(repoRoot, adapterRelative);
  const adapter = read(adapterRelative);
  if (fs.existsSync(adapterPath) && fs.lstatSync(adapterPath).isSymbolicLink()) {
    errors.push(`${adapterRelative} must be a regular file, not a symlink`);
  }
  requireText(adapter, `name: ${skillName}`, adapterRelative);
  requireText(adapter, `../../../.agents/skills/${skillName}/SKILL.md`, adapterRelative);
}

const canonicalRoot = path.join(repoRoot, ".agents/skills");
if (fs.existsSync(canonicalRoot)) {
  const actual = fs.readdirSync(canonicalRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const expected = [...skillNames].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`canonical skill registry mismatch: expected ${expected.join(", ")}; found ${actual.join(", ")}`);
  }
}

if (packageJson.scripts?.["skills:check"] !== "node .agents/skills/pointview-maintain-skills/scripts/audit-alignment.mjs") {
  errors.push("package.json skills:check is missing or misaligned");
}
if (!packageJson.scripts?.check?.includes("npm run skills:check")) {
  errors.push("package.json check must include skills:check");
}

for (const relativePath of [
  ".agents/skills/pointview-release-canary/scripts/check-candidate.mjs",
  ".agents/skills/pointview-release-canary/scripts/check-chart-version.mjs",
  ".agents/skills/pointview-release-canary/scripts/verify-live.mjs",
  "scripts/verify-live.mjs",
  "scripts/verify-live-contract.mjs",
  "scripts/verify-live-fixture.mjs",
  ".agents/skills/pointview-pipeline-health/scripts/audit-project.mjs",
]) {
  read(relativePath);
}

if (errors.length) {
  console.error(`PointView skill alignment failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`PointView skill alignment OK: ${pipelineSkillNames.length} workflow skills, ${sharedDesignSkillNames.length} shared design skills, ${skillNames.length} Claude adapters.`);
