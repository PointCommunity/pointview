import type postgres from "postgres";
import { z } from "zod";

import { appendAuditEventInTransaction } from "@/server/audit/repository";
import { newId } from "@/server/db/ids";
import type { RequestAccount } from "@/server/feedback/service";

export class RequeueError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) { super(message); this.name = "RequeueError"; }
}

export async function requeueFeedback(sql: postgres.Sql, options: { actor: RequestAccount; feedbackId: string; explanation: unknown; correlationId: string }) {
  if (options.actor.status !== "ACTIVE" || options.actor.role === "USER") throw new RequeueError("ACCESS_DENIED", "Only an Admin or Owner may requeue feedback", 403);
  const parsed = z.string().trim().min(10).max(4_000).safeParse(options.explanation);
  if (!parsed.success) throw new RequeueError("REQUEUE_EXPLANATION_INVALID", "A corrective-action explanation of at least 10 characters is required", 400);
  return sql.begin(async (tx) => {
    const [record] = await tx<{ id: string; sequence: number; state: string }[]>`
      select id, sequence, state from feedback_records where id = ${options.feedbackId} for update
    `;
    if (!record) throw new RequeueError("FEEDBACK_NOT_FOUND", "Feedback record was not found", 404);
    if (record.state !== "NEEDS_ATTENTION") throw new RequeueError("REQUEUE_STATE_INVALID", "Only Needs Attention feedback can be requeued", 409);
    const [lease] = await tx<{ id: string }[]>`select id from feedback_leases where feedback_record_id = ${record.id} and released_at is null`;
    if (lease) throw new RequeueError("REQUEUE_LEASE_ACTIVE", "Feedback still has an active lease", 409);
    const [resumable] = await tx<{ count: number }[]>`
      select count(*)::int as count from triage_decisions td join feedback_units fu on fu.id = td.unit_id
      where fu.feedback_record_id = ${record.id} and td.active and fu.state = 'APPLYING'
        and td.state in ('PRECONDITIONS_VALID', 'APPLYING', 'READBACK_CONFIRMED')
    `;
    if (resumable.count === 0) {
      await tx`update triage_decisions set active = false where active and unit_id in (select id from feedback_units where feedback_record_id = ${record.id})`;
    }
    await tx`update feedback_records set state = 'QUEUED' where id = ${record.id}`;
    await tx`insert into feedback_annotations (id, feedback_record_id, author_account_id, kind, body) values (${newId()}, ${record.id}, ${options.actor.accountId}, 'REQUEUE', ${parsed.data})`;
    await appendAuditEventInTransaction(tx, {
      id: newId(), eventAt: new Date().toISOString(), actorType: "ACCOUNT", actorId: options.actor.accountId,
      action: "feedback.requeued", targetType: "feedback_record", targetId: record.id, result: "SUCCESS",
      correlationId: options.correlationId, safeMetadata: { sequence: record.sequence, resumedOperation: resumable.count > 0 },
    });
    return { id: record.id, state: "QUEUED" as const, sequence: record.sequence, resumedOperation: resumable.count > 0 };
  });
}
