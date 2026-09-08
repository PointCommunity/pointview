import type postgres from "postgres";

export type OperationsSnapshot = {
  queueDepth: number;
  oldestQueuedSeconds: number;
  needsAttention: number;
  completedBatches: number;
  stoppedBatches: number;
  retries: number;
  githubRateLimits: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicros: number | null;
  lastSuccessfulCycle: Date | null;
};

export async function operationsSnapshot(sql: postgres.Sql): Promise<OperationsSnapshot> {
  const [row] = await sql<OperationsSnapshot[]>`
    select
      (select count(*)::int from feedback_records where state = 'QUEUED') as "queueDepth",
      coalesce((select extract(epoch from now() - min(submitted_at))::int from feedback_records where state = 'QUEUED'), 0) as "oldestQueuedSeconds",
      (select count(*)::int from feedback_records where state = 'NEEDS_ATTENTION') as "needsAttention",
      (select count(*)::int from triage_batches where state = 'COMPLETED') as "completedBatches",
      (select count(*)::int from triage_batches where state in ('STOPPED', 'FAILED')) as "stoppedBatches",
      (select count(*)::int from feedback_leases where attempt > 1) as retries,
      (select count(*)::int from triage_batches where stop_reason = 'GITHUB_RATE_LIMIT') as "githubRateLimits",
      coalesce((select sum(input_tokens)::int from model_runs), 0) as "inputTokens",
      coalesce((select sum(output_tokens)::int from model_runs), 0) as "outputTokens",
      (select case when count(estimated_cost_micros) > 0 then sum(estimated_cost_micros)::float8 else null end from model_runs) as "estimatedCostMicros",
      (select max(finished_at) from triage_batches where state = 'COMPLETED') as "lastSuccessfulCycle"
  `;
  return row;
}

export function renderPrometheus(snapshot: OperationsSnapshot): string {
  const timestamp = snapshot.lastSuccessfulCycle ? Math.floor(snapshot.lastSuccessfulCycle.getTime() / 1_000) : 0;
  const lines = [
    "# HELP pointview_queue_depth Feedback records waiting for triage.",
    "# TYPE pointview_queue_depth gauge",
    `pointview_queue_depth ${snapshot.queueDepth}`,
    "# HELP pointview_oldest_queued_seconds Age of the oldest queued record.",
    "# TYPE pointview_oldest_queued_seconds gauge",
    `pointview_oldest_queued_seconds ${snapshot.oldestQueuedSeconds}`,
    `pointview_needs_attention ${snapshot.needsAttention}`,
    `pointview_triage_batches_total{result="completed"} ${snapshot.completedBatches}`,
    `pointview_triage_batches_total{result="stopped"} ${snapshot.stoppedBatches}`,
    `pointview_triage_retries_total ${snapshot.retries}`,
    `pointview_github_rate_limits_total ${snapshot.githubRateLimits}`,
    `pointview_model_tokens_total{direction="input"} ${snapshot.inputTokens}`,
    `pointview_model_tokens_total{direction="output"} ${snapshot.outputTokens}`,
    `pointview_last_successful_cycle_timestamp_seconds ${timestamp}`,
  ];
  if (snapshot.estimatedCostMicros !== null) lines.push(`pointview_model_estimated_cost_micros_total ${snapshot.estimatedCostMicros}`);
  return [...lines, ""].join("\n");
}
