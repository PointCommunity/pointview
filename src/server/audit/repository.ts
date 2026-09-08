import type postgres from "postgres";

import { createAuditEvent, type AuditEventInput } from "./chain";

type NewAuditEvent = Omit<AuditEventInput, "previousEventHash">;

export async function appendAuditEventInTransaction(tx: postgres.TransactionSql, input: NewAuditEvent) {
  await tx`select pg_advisory_xact_lock(697021003)`;
  const [previous] = await tx<{ eventHash: string }[]>`
    select event_hash as "eventHash" from audit_events order by event_at desc, id desc limit 1
  `;
  const event = createAuditEvent({ ...input, previousEventHash: previous?.eventHash ?? null });
  await tx`
    insert into audit_events (
      id, event_at, actor_type, actor_id, action, target_type, target_id, result, reason_code,
      correlation_id, operation_id, safe_metadata, previous_event_hash, event_hash
    ) values (
      ${event.id}, ${event.eventAt}, ${event.actorType}, ${event.actorId}, ${event.action}, ${event.targetType},
      ${event.targetId}, ${event.result}, ${event.reasonCode ?? null}, ${event.correlationId},
      ${event.operationId ?? null}, ${tx.json(event.safeMetadata)}, ${event.previousEventHash}, ${event.eventHash}
    )
  `;
  return event;
}

export async function appendAuditEvent(sql: postgres.Sql, input: NewAuditEvent) {
  return sql.begin((tx) => appendAuditEventInTransaction(tx, input));
}
