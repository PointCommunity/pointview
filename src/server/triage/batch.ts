export type Lease = { leaseId: string; recordId: string };

export interface DrainQueue {
  startBatch(): Promise<string | null>;
  leaseOldest(batchId: string): Promise<Lease | null>;
  completeLease(leaseId: string, recordId: string): Promise<void>;
  failLease(leaseId: string, recordId: string, code: string): Promise<void>;
  retryLease?(leaseId: string, recordId: string, code: string): Promise<void>;
  finishBatch(batchId: string, reason: string, counts: { completed: number; needsAttention: number }): Promise<void>;
  isPaused?(): Promise<boolean>;
}

export class RecordFailure extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "RecordFailure";
  }
}

export class IntegrationFailure extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "IntegrationFailure";
  }
}

export async function drainQueue(queue: DrainQueue, processRecord: (lease: Lease) => Promise<void>) {
  const batchId = await queue.startBatch();
  if (!batchId) return { completed: 0, needsAttention: 0, stopReason: "ALREADY_RUNNING" };

  let completed = 0;
  let needsAttention = 0;
  let stopReason = "QUEUE_EMPTY";
  try {
    while (true) {
      if (await queue.isPaused?.()) {
        stopReason = "OWNER_PAUSED";
        break;
      }
      const lease = await queue.leaseOldest(batchId);
      if (!lease) break;
      try {
        await processRecord(lease);
        await queue.completeLease(lease.leaseId, lease.recordId);
        completed += 1;
      } catch (error) {
        if (error instanceof RecordFailure) {
          await queue.failLease(lease.leaseId, lease.recordId, error.code);
          needsAttention += 1;
          continue;
        }
        const code = error instanceof IntegrationFailure ? error.code : "UNCLASSIFIED_INTEGRATION_FAILURE";
        if (queue.retryLease) await queue.retryLease(lease.leaseId, lease.recordId, code);
        else await queue.failLease(lease.leaseId, lease.recordId, code);
        stopReason = code;
        break;
      }
    }
  } finally {
    await queue.finishBatch(batchId, stopReason, { completed, needsAttention });
  }
  return { completed, needsAttention, stopReason };
}
