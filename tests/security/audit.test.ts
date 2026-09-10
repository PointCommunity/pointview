import { describe, expect, it } from "vitest";

import { createAuditEvent, verifyAuditChain } from "@/server/audit/chain";

describe("audit chain", () => {
  it("detects mutation and excludes prohibited metadata keys", () => {
    const first = createAuditEvent({
      id: "018f4f6d-7c00-7000-8000-000000000001",
      eventAt: "2026-09-07T12:00:00.000Z",
      actorType: "ACCOUNT",
      actorId: "018f4f6d-7c00-7000-8000-000000000002",
      action: "feedback.submitted",
      targetType: "feedback",
      targetId: "018f4f6d-7c00-7000-8000-000000000003",
      result: "SUCCESS",
      correlationId: "018f4f6d-7c00-7000-8000-000000000004",
      safeMetadata: { attachmentCount: 1 },
      previousEventHash: null,
    });
    const second = createAuditEvent({
      ...first,
      id: "018f4f6d-7c00-7000-8000-000000000005",
      action: "feedback.leased",
      previousEventHash: first.eventHash,
    });
    expect(verifyAuditChain([first, second])).toBe(true);
    expect(verifyAuditChain([first, { ...second, result: "FAILED" }])).toBe(false);
    expect(() => createAuditEvent({ ...first, safeMetadata: { feedbackText: "secret" } })).toThrow(/prohibited/);
  });
});
