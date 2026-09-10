import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const allowedExtension = /(?:^|\/)(?:[^/]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|html|css|scss|sql|yaml|yml|toml)|Dockerfile|AGENTS\.md)$/i;

export function redactEvidence(value: string): string {
  return value
    .replace(/\b(?:gh[oprsu]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,})\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_PROVIDER_KEY]")
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s]+/gi, "$1[REDACTED]");
}

async function command(binary: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  try {
    return await execute(binary, args, {
      cwd: options.cwd,
      env: options.env,
      maxBuffer: 2 * 1024 * 1024,
      timeout: 30_000,
    });
  } catch (error) {
    const detail = error instanceof Error ? redactEvidence(error.message) : "command failed";
    throw new Error(`${binary} failed: ${detail}`);
  }
}

export async function collectRepositoryEvidence(input: {
  repositoryUrl: string;
  query: string;
  maxFiles?: number;
  accessToken?: string;
  allowLocalFixture?: boolean;
}) {
  const local = path.isAbsolute(input.repositoryUrl);
  if (local && !input.allowLocalFixture) throw new Error("Local repository research is restricted to explicit test fixtures");
  if (!local) {
    const url = new URL(input.repositoryUrl);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password) {
      throw new Error("Repository URL must be a credential-free GitHub HTTPS URL");
    }
  }
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "pointview-research-"));
  const checkout = path.join(workspace, "checkout");
  const askpass = path.join(workspace, "askpass.sh");
  const environment = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    POINTVIEW_GITHUB_TOKEN: input.accessToken ?? "",
    GIT_ASKPASS: askpass,
  };
  try {
    await fs.writeFile(
      askpass,
      "#!/bin/sh\ncase \"$1\" in\n  *Username*) printf '%s\\n' 'x-access-token' ;;\n  *) printf '%s\\n' \"$POINTVIEW_GITHUB_TOKEN\" ;;\nesac\n",
      { mode: 0o700 },
    );
    await command("git", ["clone", "--depth=50", "--no-tags", "--", input.repositoryUrl, checkout], { env: environment });
    const revision = (await command("git", ["rev-parse", "HEAD"], { cwd: checkout, env: environment })).stdout.trim();
    const tracked = (await command("git", ["ls-files"], { cwd: checkout, env: environment })).stdout
      .split("\n")
      .filter((file) => allowedExtension.test(file));
    const queryTerms = [...new Set(input.query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].slice(0, 8);
    const ranked = tracked.map((file) => ({
      file,
      score: queryTerms.reduce((score, term) => score + (file.toLowerCase().includes(term) ? 3 : 0), 0),
    }));
    for (const candidate of ranked) {
      const absolute = path.join(checkout, candidate.file);
      const stat = await fs.stat(absolute);
      if (stat.size > 256 * 1024) continue;
      const source = await fs.readFile(absolute, "utf8");
      candidate.score += queryTerms.reduce((score, term) => score + (source.toLowerCase().includes(term) ? 1 : 0), 0);
    }
    const selected = ranked
      .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
      .slice(0, Math.min(input.maxFiles ?? 20, 50));
    const files = [];
    for (const candidate of selected) {
      const source = await fs.readFile(path.join(checkout, candidate.file), "utf8");
      const sanitized = redactEvidence(source.slice(0, 12_000));
      files.push({
        path: candidate.file,
        excerpt: sanitized,
        digest: createHash("sha256").update(sanitized).digest("hex"),
      });
    }
    const history = (await command("git", ["log", "-20", "--format=%H%x09%aI%x09%s"], { cwd: checkout, env: environment })).stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => redactEvidence(line));
    return { revision, files, history };
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}
