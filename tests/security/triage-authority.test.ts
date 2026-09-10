import { describe, expect, it } from "vitest";

import { GitHubMutationAdapter } from "@/server/github/mutation-port";

describe("triage GitHub authority", () => {
  it("exposes no development, release, close, assignment, or Status mutation method", () => {
    const methods = Object.getOwnPropertyNames(GitHubMutationAdapter.prototype).filter((name) => name !== "constructor");
    expect(methods).toEqual(expect.arrayContaining([
      "createIssue", "setLabels", "addToProject", "setProjectFields", "createComment", "readIssue", "readComment",
    ]));
    expect(methods.join(" ")).not.toMatch(/branch|pullRequest|release|deploy|closeIssue|assign|setStatus/i);
  });
});
