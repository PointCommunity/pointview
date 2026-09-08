import type postgres from "postgres";

import { newId } from "@/server/db/ids";

import type { DrainQueue, Lease } from "./batch";

export class PostgresDrainQueue implements DrainQueue {
  readonly heartbeatEveryMs: number;

  constructor(
    readonly sql: postgres.Sql,
    readonly runnerIdentity: string,
    readonly settingsVersion = 1,
    readonly leaseSeconds = 300,
    readonly maxAttempts = 3,
  ) {
    this.heartbeatEveryMs = Math.max(1_000, Math.floor(this.leaseSeconds * 1_000 / 3));
  }

  async #recoverExpired() {
    await this.sql.begin(async (tx) => {
      const expired = await tx<{ leaseId: string; recordId: string; attempt: number }[]>`
        select id as "leaseId", feedback_record_id as "recordId", attempt
        from feedback_leases where released_at is null and expires_at <= now()
        for update
      `;
      for (const lease of expired) {
        const exhausted = lease.attempt >= this.maxAttempts;
        await tx`
          update feedback_leases set released_at = now(), result = 'EXPIRED',
            error_classification = ${exhausted ? "RETRY_EXHAUSTED" : "LEASE_EXPIRED"}
          where id = ${lease.leaseId}
        `;
        await tx`
          update feedback_records set state = ${exhausted ? "NEEDS_ATTENTION" : "QUEUED"}
          where id = ${lease.recordId}
        `;
      }
    });
  }

  async startBatch(): Promise<string | null> {
    await this.#recoverExpired();
    const id = newId();
    const rows = await this.sql<{ id: string }[]>`
      insert into triage_batches (id, trigger_kind, scheduled_at, settings_version, runner_identity, state)
      values (${id}, 'SCHEDULED', now(), ${this.settingsVersion}, ${this.runnerIdentity}, 'RUNNING')
      on conflict do nothing returning id
    `;
    return rows[0]?.id ?? null;
  }

  async leaseOldest(batchId: string): Promise<Lease | null> {
    return this.sql.begin(async (tx) => {
      const [active] = await tx<{ id: string }[]>`
        select id from feedback_leases where released_at is null and expires_at > now() limit 1
      `;
      if (active) return null;
      const [record] = await tx<{ id: string }[]>`
        select id from feedback_records where state = 'QUEUED'
        order by sequence asc for update skip locked limit 1
      `;
      if (!record) return null;
      const [{ attempt }] = await tx<{ attempt: number }[]>`
        select (count(*) + 1)::int as attempt from feedback_leases where feedback_record_id = ${record.id}
      `;
      if (attempt > this.maxAttempts) {
        await tx`update feedback_records set state = 'NEEDS_ATTENTION' where id = ${record.id}`;
        return null;
      }
      const leaseId = newId();
      await tx`
        insert into feedback_leases (id, batch_id, feedback_record_id, attempt, idempotency_key, lease_owner, expires_at)
        values (
          ${leaseId}, ${batchId}, ${record.id}, ${attempt},
          ${`feedback:${record.id}:attempt:${attempt}`}, ${this.runnerIdentity},
          now() + (${this.leaseSeconds} * interval '1 second')
        )
      `;
      await tx`update feedback_records set state = 'LEASED' where id = ${record.id} and state = 'QUEUED'`;
      return { leaseId, recordId: record.id };
    }) as Promise<Lease | null>;
  }

  async heartbeat(leaseId: string): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      update feedback_leases set heartbeat_at = now(), expires_at = now() + (${this.leaseSeconds} * interval '1 second')
      where id = ${leaseId} and released_at is null and expires_at > now() returning id
    `;
    return rows.length === 1;
  }

  async completeLease(leaseId: string, recordId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`update feedback_leases set released_at = now(), result = 'COMPLETED' where id = ${leaseId} and feedback_record_id = ${recordId} and released_at is null`;
      await tx`
        update feedback_records
        set state = 'TRIAGED', triage_terminal_at = coalesce(triage_terminal_at, now()),
            raw_delete_after = coalesce(raw_delete_after, now() + interval '180 days')
        where id = ${recordId} and state in ('LEASED', 'RESEARCHING', 'DECIDING', 'APPLYING')
      `;
    });
  }

  async failLease(leaseId: string, recordId: string, code: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`update feedback_leases set released_at = now(), result = 'NEEDS_ATTENTION', error_classification = ${code} where id = ${leaseId} and released_at is null`;
      await tx`update feedback_records set state = 'NEEDS_ATTENTION' where id = ${recordId}`;
    });
  }

  async retryLease(leaseId: string, recordId: string, code: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`update feedback_leases set released_at = now(), result = 'RETRYABLE', error_classification = ${code} where id = ${leaseId} and released_at is null`;
      await tx`update feedback_records set state = 'QUEUED' where id = ${recordId}`;
    });
  }

  async finishBatch(batchId: string, reason: string, counts: { completed: number; needsAttention: number }): Promise<void> {
    const state = reason === "QUEUE_EMPTY" ? "COMPLETED" : "STOPPED";
    await this.sql`
      update triage_batches set state = ${state}, finished_at = now(), records_completed = ${counts.completed},
        records_needs_attention = ${counts.needsAttention}, records_attempted = ${counts.completed + counts.needsAttention},
        stop_reason = ${reason}
      where id = ${batchId} and state = 'RUNNING'
    `;
  }

  async isPaused(): Promise<boolean> {
    const [settings] = await this.sql<{ paused: boolean }[]>`
      select triage_paused as paused from application_settings order by version desc limit 1
    `;
    return settings?.paused ?? false;
  }
}
