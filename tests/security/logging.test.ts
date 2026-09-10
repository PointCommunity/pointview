import { describe, expect, it } from "vitest";

import { redactLogValue } from "@/server/audit/logger";

describe("sanitized logging", () => {
  it("redacts known secrets, raw text, identity tokens, and screenshot bytes recursively", () => {
    const value = redactLogValue({
      authorization: "Bearer secret",
      feedbackText: "private report",
      nested: { cookie: "session=secret", count: 2 },
      imageBytes: Buffer.from("private"),
    });
    expect(value).toEqual({
      authorization: "[REDACTED]",
      feedbackText: "[REDACTED]",
      nested: { cookie: "[REDACTED]", count: 2 },
      imageBytes: "[REDACTED]",
    });
  });
});
