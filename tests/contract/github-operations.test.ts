import { describe, expect, it } from "vitest";

import {
  applyConsidered,
  applyCreate,
  applyMerge,
  MemoryOperationLedger,
  type GitHubMutationPort,
  type GitHubIssueReadback,
} from "@/server/github/apply-decision";

class RecordingGitHub implements GitHubMutationPort {
  issues: GitHubIssueReadback[] = [];
  comments: Array<{ id: string; issueNodeId: string; body: string }> = [];
  calls: string[] = [];
  loseFirstCreateResponse = false;
  loseFirstCommentResponse = false;
  loseAfter: string | null = null;

  maybeLose(step: string) {
    if (this.loseAfter === step) {
      this.loseAfter = null;
      throw new Error(`network response lost after ${step}`);
    }
  }

  async readMutationPreconditions() {
    this.calls.push("readMutationPreconditions");
    return {
      nodeId: "PVT_expected",
      number: 4,
      public: false,
      repository: "PointCommunity/pointview",
      labels: ["type:feature", "area:feedback", "type:bug"],
      fields: {
        Status: ["Backlog", "On Hold", "In Progress", "In Review", "Done"],
        Priority: ["P0", "P1", "P2", "P3"],
        Impact: ["High", "Medium", "Low"],
        Effort: ["XS", "S", "M", "L", "XL"],
      },
    };
  }

  async findIssueByMarker(marker: string) {
    this.calls.push("findIssueByMarker");
    return this.issues.find((issue) => issue.body.includes(marker)) ?? null;
  }
  async createIssue(input: { title: string; body: string }) {
    this.calls.push("createIssue");
    const issue: GitHubIssueReadback = {
      nodeId: `I_${this.issues.length + 1}`,
      number: this.issues.length + 1,
      title: input.title,
      body: input.body,
      state: "OPEN",
      assignees: [],
      labels: [],
      projectItemId: null,
      status: null,
      priority: null,
      impact: null,
      effort: null,
      repository: "PointCommunity/pointview",
    };
    this.issues.push(issue);
    if (this.loseFirstCreateResponse) {
      this.loseFirstCreateResponse = false;
      throw new Error("network response lost");
    }
    this.maybeLose("createIssue");
    return issue;
  }
  async setLabels(number: number, labels: string[]) {
    this.calls.push("setLabels");
    this.issues[number - 1].labels = [...labels];
    this.maybeLose("setLabels");
  }
  async addToProject(number: number) {
    this.calls.push("addToProject");
    const id = `PVTI_${number}`;
    this.issues[number - 1].projectItemId = id;
    this.maybeLose("addToProject");
    return id;
  }
  async setProjectFields(itemId: string, fields: { status: "Backlog"; priority: string; impact: string; effort: string }) {
    this.calls.push("setProjectFields");
    const issue = this.issues.find((candidate) => candidate.projectItemId === itemId)!;
    Object.assign(issue, fields);
    this.maybeLose("setProjectFields");
  }
  async readIssue(number: number) {
    this.calls.push("readIssue");
    return this.issues[number - 1];
  }
  async readIssueByNodeId(nodeId: string) {
    this.calls.push("readIssueByNodeId");
    return this.issues.find((issue) => issue.nodeId === nodeId) ?? null;
  }
  async findCommentByMarker(issueNodeId: string, marker: string) {
    this.calls.push("findCommentByMarker");
    return this.comments.find((comment) => comment.issueNodeId === issueNodeId && comment.body.includes(marker)) ?? null;
  }
  async createComment(issueNodeId: string, body: string) {
    this.calls.push("createComment");
    const comment = { id: `C_${this.comments.length + 1}`, issueNodeId, body };
    this.comments.push(comment);
    if (this.loseFirstCommentResponse) {
      this.loseFirstCommentResponse = false;
      throw new Error("network response lost after createComment");
    }
    return comment;
  }
  async readComment(id: string) {
    this.calls.push("readComment");
    return this.comments.find((comment) => comment.id === id) ?? null;
  }
}

const createInput = {
  decisionId: "018f4f6d-7c00-7000-8000-000000000001",
  operationId: "018f4f6d-7c00-7000-8000-000000000002",
  title: "Improve feedback uploads",
  body: "<!-- pointview-operation:018f4f6d-7c00-7000-8000-000000000002 -->\n<h2>Summary</h2>",
  labels: ["type:feature", "area:feedback"],
  fields: { status: "Backlog" as const, priority: "P1", impact: "High", effort: "M" },
  expectedRepository: "PointCommunity/pointview",
  expectedProject: { nodeId: "PVT_expected", number: 4 },
};

describe("idempotent GitHub application", () => {
  it("resumes a lost create response without duplicate Issues", async () => {
    const github = new RecordingGitHub();
    const ledger = new MemoryOperationLedger();
    github.loseFirstCreateResponse = true;
    await expect(applyCreate(createInput, github, ledger)).rejects.toThrow(/lost/);
    const first = await applyCreate(createInput, github, ledger);
    const second = await applyCreate(createInput, github, ledger);
    expect(github.issues).toHaveLength(1);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ state: "OPEN", assignees: [], status: "Backlog", priority: "P1" });
  });

  it.each(["createIssue", "setLabels", "addToProject", "setProjectFields"])("resumes safely after a lost %s response", async (step) => {
    const github = new RecordingGitHub();
    const ledger = new MemoryOperationLedger();
    github.loseAfter = step;
    await expect(applyCreate(createInput, github, ledger)).rejects.toThrow(/lost/);
    const readback = await applyCreate(createInput, github, ledger);
    expect(github.issues).toHaveLength(1);
    expect(readback).toMatchObject({ status: "Backlog", priority: "P1", impact: "High", effort: "M" });
  });

  it("adds exactly one comment to a refreshed non-Done target", async () => {
    const github = new RecordingGitHub();
    github.issues.push({
      nodeId: "I_target",
      number: 8,
      title: "Existing",
      body: "Existing issue",
      state: "OPEN",
      assignees: [],
      labels: ["type:bug", "area:feedback"],
      projectItemId: "PVTI_8",
      status: "In Progress",
      priority: "P1",
      impact: "High",
      effort: "M",
      repository: "PointCommunity/pointview",
    });
    const ledger = new MemoryOperationLedger();
    const input = {
      decisionId: "018f4f6d-7c00-7000-8000-000000000003",
      operationId: "018f4f6d-7c00-7000-8000-000000000004",
      targetIssueNodeId: "I_target",
      expectedRepository: "PointCommunity/pointview",
      body: "<!-- pointview-operation:018f4f6d-7c00-7000-8000-000000000004 -->\n<p>Evidence</p>",
    };
    await applyMerge(input, github, ledger);
    await applyMerge(input, github, ledger);
    expect(github.comments).toHaveLength(1);
    expect(github.issues[0].status).toBe("In Progress");
  });

  it("recovers a lost comment response by finding the operation marker", async () => {
    const github = new RecordingGitHub();
    github.issues.push({
      nodeId: "I_target", number: 8, title: "Existing", body: "Existing issue", state: "OPEN", assignees: [],
      labels: ["type:bug", "area:feedback"], projectItemId: "PVTI_8", status: "Backlog", priority: "P1",
      impact: "High", effort: "M", repository: "PointCommunity/pointview",
    });
    github.loseFirstCommentResponse = true;
    const ledger = new MemoryOperationLedger();
    const input = {
      decisionId: "018f4f6d-7c00-7000-8000-000000000013",
      operationId: "018f4f6d-7c00-7000-8000-000000000014",
      targetIssueNodeId: "I_target",
      expectedRepository: "PointCommunity/pointview",
      body: "<!-- pointview-operation:018f4f6d-7c00-7000-8000-000000000014 -->\n<p>Evidence</p>",
    };
    await expect(applyMerge(input, github, ledger)).rejects.toThrow(/lost/);
    await applyMerge(input, github, ledger);
    expect(github.comments).toHaveLength(1);
  });

  it("records Considered without touching GitHub", async () => {
    const github = new RecordingGitHub();
    const ledger = new MemoryOperationLedger();
    await applyConsidered({ decisionId: "decision", operationId: "operation", reasonCode: "INSUFFICIENT_EVIDENCE" }, ledger);
    expect(github.calls).toEqual([]);
  });
});
