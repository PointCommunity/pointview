import { describe, expect, it } from "vitest";

import { renderPrometheus } from "@/server/operations/metrics";

describe("operations metrics", () => {
  it("renders aggregate counters without record or identity labels", () => {
    const text = renderPrometheus({ queueDepth: 3, oldestQueuedSeconds: 60, needsAttention: 1, completedBatches: 2, stoppedBatches: 1, retries: 4, githubRateLimits: 1, inputTokens: 100, outputTokens: 20, estimatedCostMicros: 12, lastSuccessfulCycle: new Date("2026-09-07T12:00:00Z") });
    expect(text).toContain("pointview_queue_depth 3");
    expect(text).toContain("pointview_needs_attention 1");
    expect(text).toContain("pointview_model_estimated_cost_micros_total 12");
    expect(text).not.toMatch(/email|feedback_text|account_id/);
  });
});
