import { describe, expect, it } from "vitest";

import { presentFeedback } from "@/server/feedback/presenter";

describe("feedback HTTP representation", () => {
  it("uses the versioned OpenAPI field shape without exposing storage keys", () => {
    const presented = presentFeedback({
      id: "018f4f6d-7c00-7000-8000-000000000091",
      state: "QUEUED",
      submittedAt: new Date("2026-09-07T12:00:00Z"),
      sourceApp: "PointGuide",
      environment: "canary",
      route: "/m32",
      screen: "M32",
      appVersion: "1.0.0",
      sourceRevision: "abc123",
      feedback: "Improve this screen",
      attachmentCount: 1,
      rawDeleteAfter: null,
      attachments: [{ id: "018f4f6d-7c00-7000-8000-000000000092", mediaType: "image/png", sizeBytes: 1200, width: 100, height: 80 }],
      units: [],
    });
    expect(presented).toMatchObject({
      source_app: "PointGuide",
      context: "M32",
      submitted_at: "2026-09-07T12:00:00.000Z",
      raw_delete_after: null,
      attachments: [{ media_type: "image/png", size_bytes: 1200 }],
    });
    expect(JSON.stringify(presented)).not.toContain("storage");
  });
});
