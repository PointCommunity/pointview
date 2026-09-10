import { describe, expect, it } from "vitest";

import { validateSourceTarget } from "@/server/source-apps/validation";

const registration = {
  githubOwner: "PointCommunity",
  githubRepo: "pointguide",
  installationId: 42,
  projectNodeId: "PVT_pointguide",
  projectNumber: 2,
  governedLabels: ["type:bug", "type:feature", "type:maintenance", "type:security", "area:ui"],
};

const readback = {
  repository: { owner: "PointCommunity", name: "pointguide", private: true, installationId: 42 },
  project: {
    nodeId: "PVT_pointguide",
    number: 2,
    private: true,
    fields: {
      Status: ["Backlog", "On Hold", "In Progress", "In Review", "Done"],
      Priority: ["P0", "P1", "P2", "P3"],
      Impact: ["High", "Medium", "Low"],
      Effort: ["XS", "S", "M", "L", "XL"],
    },
  },
  labels: ["type:bug", "type:feature", "type:maintenance", "type:security", "area:ui"],
};

describe("source app activation", () => {
  it.each([true, false])("accepts an authorized repository with private=%s", (isPrivate) => {
    expect(validateSourceTarget(registration, { ...readback, repository: { ...readback.repository, private: isPrivate } })).toEqual({ valid: true, errors: [] });
  });

  it.each([true, false])("rejects identity and installation drift with private=%s", (isPrivate) => {
    const result = validateSourceTarget(registration, {
      ...readback,
      repository: { ...readback.repository, private: isPrivate, name: "wrong", installationId: 99 },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining(["repository identity does not match registration", "GitHub installation does not match"]));
  });

  it("fails closed on Project or label drift", () => {
    const result = validateSourceTarget(registration, {
      ...readback,
      project: { ...readback.project, fields: { ...readback.project.fields, Status: ["Backlog", "Done"] } },
      labels: ["type:bug", "type:feature", "type:maintenance", "type:security"],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/Status/), expect.stringMatching(/area:ui/)]));
  });
});
