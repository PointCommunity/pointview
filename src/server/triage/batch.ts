export type Lease = { leaseId: string; recordId: string };

export interface DrainQueue {
  startBatch(): Promise<string | null>;
  leaseOldest(batchId: string): Promise<Lease | null>;
  completeLease(leaseId: string, recordId: string): Promise<void>;
  failLease(leaseId: string, recordId: string, code: string): Promise<void>;
  retryLease?(leaseId: string, recordId: string, code: string): Promise<void>;
  heartbeat?(leaseId: string): Promise<boolean>;
  heartbeatEveryMs?: number;
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
  constructor(readonly code: string, readonly retryAfterSeconds?: number) {
    super(code);
    this.name = "IntegrationFailure";
  }
}

async function processWithHeartbeat(queue: DrainQueue, lease: Lease, processRecord: (lease: Lease) => Promise<void>): Promise<void> {
  if (!queue.heartbeat) return processRecord(lease);
  let heartbeatHealthy = true;
  let heartbeatRunning = false;
  const timer = setInterval(() => {
    if (heartbeatRunning) return;
    heartbeatRunning = true;
    queue.heartbeat!(lease.leaseId)
      .then((healthy) => { heartbeatHealthy = heartbeatHealthy && healthy; })
      .catch(() => { heartbeatHealthy = false; })
      .finally(() => { heartbeatRunning = false; });
  }, queue.heartbeatEveryMs ?? 60_000);
  timer.unref?.();
  try {
    await processRecord(lease);
  } finally {
    clearInterval(timer);
  }
  if (!heartbeatHealthy) throw new IntegrationFailure("LEASE_HEARTBEAT_LOST");
}

type DrainOptions = { sleep?: (milliseconds: number) => Promise<void>; maxRetryDelaySeconds?: number };

export async function drainQueue(queue: DrainQueue, processRecord: (lease: Lease) => Promise<void>, options: DrainOptions = {}) {
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
        await processWithHeartbeat(queue, lease, processRecord);
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
        if (
          error instanceof IntegrationFailure &&
          error.retryAfterSeconds !== undefined &&
          error.retryAfterSeconds <= (options.maxRetryDelaySeconds ?? 900) &&
          queue.retryLease
        ) {
          await (options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))))(error.retryAfterSeconds * 1_000);
          continue;
        }
        stopReason = code;
        break;
      }
    }
  } finally {
    await queue.finishBatch(batchId, stopReason, { completed, needsAttention });
  }
  return { completed, needsAttention, stopReason };
}
