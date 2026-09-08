#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const OWNER = "PointCommunity";
const REPO = `${OWNER}/pointview`;
const PROJECT_NUMBER = "4";
const ACTIVE = new Set(["In Progress", "In Review"]);
const REQUIRED_STATUS = ["Backlog", "On Hold", "In Progress", "In Review", "Done"];
const REQUIRED_FIELDS = {
  Priority: ["P0", "P1", "P2", "P3"],
  Impact: ["High", "Medium", "Low"],
  Effort: ["XS", "S", "M", "L", "XL"],
};
const REQUIRED_LABELS = new Set([
  "type:bug", "type:feature", "type:maintenance", "type:security",
  "area:ai", "area:data", "area:deployment", "area:documentation",
  "area:feedback", "area:github", "area:identity", "area:security",
  "area:ui", "area:workflow",
]);
const errors = [];

function gh(args) {
  try {
    return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(`gh ${args.join(" ")} failed: ${detail}`);
  }
}

function ghJson(args) {
  const output = gh(args);
  return output ? JSON.parse(output) : {};
}

const project = ghJson(["project", "view", PROJECT_NUMBER, "--owner", OWNER, "--format", "json"]);
if (project.title !== "PointView" || project.public !== false || project.closed !== false) {
  errors.push("Project must be the open private PointCommunity/PointView Project");
}

const fieldData = ghJson(["project", "field-list", PROJECT_NUMBER, "--owner", OWNER, "--format", "json"]);
const fields = new Map(fieldData.fields.map((field) => [field.name, field]));
const statusOptions = fields.get("Status")?.options?.map((option) => option.name) ?? [];
if (JSON.stringify(statusOptions) !== JSON.stringify(REQUIRED_STATUS)) {
  errors.push(`Status options mismatch: ${statusOptions.join(", ")}`);
}
for (const [fieldName, expectedOptions] of Object.entries(REQUIRED_FIELDS)) {
  const options = fields.get(fieldName)?.options?.map((option) => option.name) ?? [];
  if (JSON.stringify(options) !== JSON.stringify(expectedOptions)) {
    errors.push(`${fieldName} options mismatch: ${options.join(", ")}`);
  }
}

const labelData = ghJson(["label", "list", "--repo", REPO, "--limit", "200", "--json", "name"]);
const labelNames = new Set(labelData.map((label) => label.name));
for (const requiredLabel of REQUIRED_LABELS) {
  if (!labelNames.has(requiredLabel)) errors.push(`repository is missing governed label ${requiredLabel}`);
}

const itemData = ghJson(["project", "item-list", PROJECT_NUMBER, "--owner", OWNER, "--limit", "1000", "--format", "json"]);
const issueItems = itemData.items.filter((item) => item.content?.type === "Issue");
const itemByNumber = new Map(issueItems.map((item) => [item.content.number, item]));
const openIssues = ghJson(["issue", "list", "--repo", REPO, "--state", "open", "--limit", "1000", "--json", "number,title,labels,assignees,url"]);

for (const issue of openIssues) {
  const item = itemByNumber.get(issue.number);
  if (!item) {
    errors.push(`open Issue #${issue.number} is missing from the Project`);
    continue;
  }
  for (const fieldName of ["status", "priority", "impact", "effort"]) {
    if (!item[fieldName]) errors.push(`Issue #${issue.number} is missing ${fieldName}`);
  }
  const issueLabelNames = issue.labels.map((label) => label.name);
  const typeLabels = issueLabelNames.filter((name) => name.startsWith("type:"));
  const areaLabels = issueLabelNames.filter((name) => name.startsWith("area:"));
  if (typeLabels.length !== 1) errors.push(`Issue #${issue.number} must have exactly one type label`);
  if (areaLabels.length < 1) errors.push(`Issue #${issue.number} must have at least one area label`);
  if (ACTIVE.has(item.status)) {
    const assignees = issue.assignees.map((assignee) => assignee.login);
    if (assignees.length !== 1 || assignees[0] !== "brimdor") {
      errors.push(`active Issue #${issue.number} must be assigned only to brimdor`);
    }
  } else if (item.status === "Backlog" && issue.assignees.length) {
    errors.push(`Backlog Issue #${issue.number} must be unassigned`);
  } else if (item.status === "Done") {
    errors.push(`open Issue #${issue.number} must not have Status Done`);
  }
}

const activeItems = issueItems.filter((item) => ACTIVE.has(item.status));
if (activeItems.length > 1) {
  errors.push(`single-active-Issue violation: ${activeItems.map((item) => `#${item.content.number}`).join(", ")}`);
}

const openPrs = ghJson(["pr", "list", "--repo", REPO, "--state", "open", "--limit", "1000", "--json", "number,title,body,isDraft,headRefName,headRefOid,baseRefName,statusCheckRollup,url"]);
const autoClosePattern = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#\d+/i;
for (const pr of openPrs) {
  if (pr.baseRefName !== "main") errors.push(`PR #${pr.number} must target main`);
  if (autoClosePattern.test(pr.body || "")) errors.push(`PR #${pr.number} contains a forbidden auto-close keyword`);
  const refs = [...(pr.body || "").matchAll(/\bRefs\s+#(\d+)/gi)].map((match) => Number(match[1]));
  if (!refs.length) errors.push(`PR #${pr.number} does not reference an Issue with Refs #N`);
  for (const issueNumber of refs) {
    if (!itemByNumber.has(issueNumber)) errors.push(`PR #${pr.number} references Issue #${issueNumber}, which is not in the Project`);
  }
  if (refs.length === 1 && !new RegExp(`^issue/${refs[0]}-[a-z0-9][a-z0-9-]*$`).test(pr.headRefName)) {
    errors.push(`PR #${pr.number} branch must match issue/${refs[0]}-<slug>`);
  }
}

for (const item of activeItems.filter((candidate) => candidate.status === "In Review")) {
  const matching = openPrs.filter((pr) => new RegExp(`\\bRefs\\s+#${item.content.number}\\b`, "i").test(pr.body || ""));
  if (matching.length !== 1) {
    errors.push(`In Review Issue #${item.content.number} must have exactly one open referenced PR`);
    continue;
  }
  const pr = matching[0];
  if (pr.isDraft) errors.push(`In Review PR #${pr.number} must be ready for review`);
  for (const [workflowName, checkName] of [["Quality", "verify"], ["Container", "amd64"]]) {
    const check = (pr.statusCheckRollup || []).find((candidate) => candidate.name === checkName && candidate.workflowName === workflowName);
    if (!check || check.status !== "COMPLETED" || check.conclusion !== "SUCCESS") {
      errors.push(`In Review PR #${pr.number} lacks successful ${workflowName} / ${checkName} evidence`);
    }
  }
}

if (errors.length) {
  console.error(`PointView pipeline health failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const activeSummary = activeItems.length ? `#${activeItems[0].content.number} ${activeItems[0].status}` : "none";
console.log(`PointView pipeline health OK: ${openIssues.length} open Issue(s), active=${activeSummary}, ${openPrs.length} open PR(s).`);
