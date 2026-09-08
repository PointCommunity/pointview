import { describe, expect, it } from "vitest";

import { validateSourceTarget } from "@/server/source-apps/validation";

const registration = {
  githubOwner: "PointCommunity",
  githubRepo: "pointguide",
  installationId: 42,
  projectNodeId: "PVT_pointguide",
  projectNumber: 2,
  creationLabels: ["type:feature", "area:ui"],
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
  labels: ["type:feature", "area:ui"],
};

describe("source app activation", () => {
  it("accepts only exact private repository, installation, Project, fields, and labels", () => {
    expect(validateSourceTarget(registration, readback)).toEqual({ valid: true, errors: [] });
  });

  it("fails closed on Project or label drift", () => {
    const result = validateSourceTarget(registration, {
      ...readback,
      project: { ...readback.project, fields: { ...readback.project.fields, Status: ["Backlog", "Done"] } },
      labels: ["type:feature"],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/Status/), expect.stringMatching(/area:ui/)]));
  });
});
