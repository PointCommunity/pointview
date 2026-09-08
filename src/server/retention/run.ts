import type postgres from "postgres";

import { appendAuditEventInTransaction } from "@/server/audit/repository";
import { newId } from "@/server/db/ids";

export type RetentionStore = { delete(key: string): Promise<void>; exists(key: string): Promise<boolean> };

type Candidate = { id: string };
type Attachment = { id: string; storageKey: string; byteSize: number };

export type RetentionResult = { selected: number; deleted: number; failed: number; deletedBytes: number };

export async function runRetention(
  sql: postgres.Sql,
  store: RetentionStore,
  options: { now?: Date; limit?: number; correlationId?: string } = {},
): Promise<RetentionResult> {
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 1_000);
  const candidates = await sql<Candidate[]>`
    select fr.id from feedback_records fr
    where fr.state = 'TRIAGED' and fr.raw_deleted_at is null and fr.raw_delete_after <= ${now}
      and not exists (
        select 1 from feedback_units fu where fu.feedback_record_id = fr.id and fu.state <> 'TERMINAL'
      )
    order by fr.raw_delete_after, fr.sequence limit ${limit}
  `;
  const result: RetentionResult = { selected: candidates.length, deleted: 0, failed: 0, deletedBytes: 0 };
  for (const candidate of candidates) {
    try {
      const attachments = await sql<Attachment[]>`
        select id, storage_key as "storageKey", byte_size as "byteSize" from attachments
        where feedback_record_id = ${candidate.id} and deleted_at is null order by ordinal
      `;
      for (const attachment of attachments) {
        await store.delete(attachment.storageKey);
        if (await store.exists(attachment.storageKey)) throw new Error("Attachment deletion could not be verified");
      }
      await sql.begin(async (tx) => {
        const [locked] = await tx<{ id: string }[]>`
          select id from feedback_records where id = ${candidate.id} and state = 'TRIAGED'
            and raw_deleted_at is null and raw_delete_after <= ${now} for update
        `;
        if (!locked) return;
        await tx`update attachments set deleted_at = coalesce(deleted_at, ${now}) where feedback_record_id = ${candidate.id}`;
        await tx`delete from feedback_payloads where feedback_record_id = ${candidate.id}`;
        await tx`update feedback_records set raw_deleted_at = ${now} where id = ${candidate.id}`;
        await appendAuditEventInTransaction(tx, {
          id: newId(), eventAt: now.toISOString(), actorType: "SYSTEM", actorId: null,
          action: "retention.content_deleted", targetType: "feedback_record", targetId: candidate.id, result: "SUCCESS",
          correlationId: options.correlationId ?? newId(),
          safeMetadata: { attachmentCount: attachments.length, deletedBytes: attachments.reduce((sum, item) => sum + item.byteSize, 0) },
        });
      });
      result.deleted += 1;
      result.deletedBytes += attachments.reduce((sum, item) => sum + item.byteSize, 0);
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
