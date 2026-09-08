#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const documents = ["architecture.html", "source-app-integration.html", "operations.html", "privacy-and-retention.html"];
const errors = [];

for (const document of documents) {
  const filePath = path.join("docs", document);
  if (!fs.existsSync(filePath)) {
    errors.push(`missing ${filePath}`);
    continue;
  }
  const html = fs.readFileSync(filePath, "utf8");
  for (const required of ["<html lang=\"en\">", "<meta name=\"color-scheme\" content=\"dark\">", "class=\"skip-link\"", "<main id=\"content\">"]) {
    if (!html.includes(required)) errors.push(`${filePath} is missing ${required}`);
  }
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const href = match[1];
    if (!href || href.startsWith("#") || href.startsWith("https://")) continue;
    const target = path.resolve("docs", href.split("#", 1)[0]);
    if (!fs.existsSync(target)) errors.push(`${filePath} links to missing ${href}`);
  }
}

const stylesheet = fs.readFileSync(path.join("docs", "pointview-docs.css"), "utf8");
for (const required of ["color-scheme: dark", ":focus-visible", "prefers-reduced-motion", "overflow-x: auto"]) {
  if (!stylesheet.includes(required)) errors.push(`docs/pointview-docs.css is missing ${required}`);
}

if (errors.length) {
  console.error(`PointView documentation audit failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`PointView documentation audit OK: ${documents.length} dark-mode HTML documents and local links verified.`);
