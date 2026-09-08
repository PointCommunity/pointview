import { describe, expect, it } from "vitest";

import { IntegrationFailure, RecordFailure, drainQueue, type DrainQueue } from "@/server/triage/batch";

class MemoryQueue implements DrainQueue {
  readonly records: string[];
  readonly completed: string[] = [];
  readonly needsAttention: string[] = [];
  started = false;
  finishedWith: string | null = null;

  constructor(records: string[]) {
    this.records = [...records];
  }
  async startBatch() {
    if (this.started) return null;
    this.started = true;
    return "batch-1";
  }
  async leaseOldest() {
    const recordId = this.records.shift();
    return recordId ? { leaseId: `lease-${recordId}`, recordId } : null;
  }
  async completeLease(_leaseId: string, recordId: string) {
    this.completed.push(recordId);
  }
  async failLease(_leaseId: string, recordId: string) {
    this.needsAttention.push(recordId);
  }
  async retryLease(_leaseId: string, recordId: string) {
    this.records.unshift(recordId);
  }
  async finishBatch(_batchId: string, reason: string) {
    this.finishedWith = reason;
    this.started = false;
  }
}

describe("daily sequential drain", () => {
  it("processes oldest-first one at a time and continues past isolated record failure", async () => {
    const queue = new MemoryQueue(["one", "two", "three"]);
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const result = await drainQueue(queue, async ({ recordId }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(recordId);
      await Promise.resolve();
      active -= 1;
      if (recordId === "two") throw new RecordFailure("MODEL_OUTPUT_INVALID");
    });
    expect(order).toEqual(["one", "two", "three"]);
    expect(maxActive).toBe(1);
    expect(queue.completed).toEqual(["one", "three"]);
    expect(queue.needsAttention).toEqual(["two"]);
    expect(result).toMatchObject({ completed: 2, needsAttention: 1, stopReason: "QUEUE_EMPTY" });
  });

  it("stops on a blocking integration failure and cannot overlap", async () => {
    const queue = new MemoryQueue(["one", "two"]);
    const first = await drainQueue(queue, async () => {
      throw new IntegrationFailure("GITHUB_UNAVAILABLE");
    });
    expect(first.stopReason).toBe("GITHUB_UNAVAILABLE");
    expect(queue.records).toEqual(["one", "two"]);

    const overlapQueue = new MemoryQueue(["one"]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const running = drainQueue(overlapQueue, async () => gate);
    await Promise.resolve();
    const overlap = await drainQueue(overlapQueue, async () => undefined);
    expect(overlap.stopReason).toBe("ALREADY_RUNNING");
    release();
    await running;
  });
});
