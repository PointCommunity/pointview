import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { collectRepositoryEvidence, redactEvidence } from "@/server/research/repository";

const run = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("ephemeral repository research", () => {
  it("collects bounded relevant code/history without treating the query as a command", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pointview-repo-fixture-"));
    roots.push(root);
    await run("git", ["init", "-b", "main"], { cwd: root });
    await run("git", ["config", "user.email", "fixture@example.test"], { cwd: root });
    await run("git", ["config", "user.name", "Fixture"], { cwd: root });
    await fs.writeFile(path.join(root, "feedback.ts"), "export const screenshotUpload = true;\n", "utf8");
    await fs.writeFile(path.join(root, "README.md"), "Screenshot upload feedback behavior.\n", "utf8");
    await run("git", ["add", "."], { cwd: root });
    await run("git", ["commit", "-m", "Add screenshot upload"], { cwd: root });

    const evidence = await collectRepositoryEvidence({
      repositoryUrl: root,
      query: "screenshot upload; touch /tmp/pointview-should-not-exist",
      maxFiles: 10,
      allowLocalFixture: true,
    });
    expect(evidence.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(evidence.files.map((file) => file.path)).toEqual(expect.arrayContaining(["README.md", "feedback.ts"]));
    await expect(fs.access("/tmp/pointview-should-not-exist")).rejects.toThrow();
  });

  it("redacts credential-shaped material from excerpts", () => {
    expect(redactEvidence("Authorization: Bearer abc123\nOPENAI_API_KEY=sk-secret-value\nghp_abcdefghijklmnop")).not.toMatch(
      /abc123|sk-secret|ghp_/,
    );
  });
});
