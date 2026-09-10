import { describe, expect, it } from "vitest";

import { problem, withCorrelationId } from "@/server/http/problem";

describe("Problem Details", () => {
  it("returns RFC 9457-compatible safe JSON", async () => {
    const response = problem({ status: 403, title: "Forbidden", code: "ACCESS_DENIED" }, "corr-1");
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(await response.json()).toEqual({
      type: "https://view.pointatx.org/problems/access-denied",
      title: "Forbidden",
      status: 403,
      code: "ACCESS_DENIED",
      correlationId: "corr-1",
    });
  });

  it("accepts only bounded incoming correlation IDs", () => {
    const expected = "018f4f6d-7c00-7000-8000-000000000071";
    expect(withCorrelationId(new Headers({ "x-correlation-id": expected }))).toBe(expected);
    expect(withCorrelationId(new Headers({ "x-correlation-id": "request_123" }))).toMatch(/^[0-9a-f-]{36}$/);
    expect(withCorrelationId(new Headers({ "x-correlation-id": "../../secret" }))).toMatch(/^[0-9a-f-]{36}$/);
  });
});
