import { describe, expect, it } from "vitest";

import { FixedWindowRateLimiter } from "@/server/http/rate-limit";

describe("FixedWindowRateLimiter", () => {
  it("limits one identity without starving another", () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter({ limit: 2, windowMs: 1_000, now: () => now });

    expect(limiter.consume("account-a").allowed).toBe(true);
    expect(limiter.consume("account-a").allowed).toBe(true);
    expect(limiter.consume("account-a")).toMatchObject({ allowed: false, retryAfterSeconds: 1 });
    expect(limiter.consume("account-b").allowed).toBe(true);

    now = 2_001;
    expect(limiter.consume("account-a").allowed).toBe(true);
  });
});
