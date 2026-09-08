import { createHash } from "node:crypto";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type AuditEventInput = {
  id: string;
  eventAt: string;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  result: string;
  reasonCode?: string | null;
  correlationId: string;
  operationId?: string | null;
  safeMetadata: Record<string, Json>;
  previousEventHash: string | null;
};

export type AuditEvent = AuditEventInput & { eventHash: string };

const prohibitedKey = /(?:feedback.?text|raw|token|assertion|authorization|cookie|secret|password|private.?key|image|screenshot|provider.?output)/i;

function assertSafeMetadata(value: Json, path = "metadata"): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeMetadata(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (prohibitedKey.test(key)) throw new Error(`Audit metadata contains prohibited key at ${path}.${key}`);
    assertSafeMetadata(child, `${path}.${key}`);
  }
}

function canonical(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function digest(input: AuditEventInput): string {
  return createHash("sha256").update(canonical(input as unknown as Json)).digest("hex");
}

export function createAuditEvent(input: AuditEventInput): AuditEvent {
  assertSafeMetadata(input.safeMetadata);
  const normalized: AuditEventInput = {
    id: input.id,
    eventAt: input.eventAt,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    result: input.result,
    reasonCode: input.reasonCode ?? null,
    correlationId: input.correlationId,
    operationId: input.operationId ?? null,
    safeMetadata: input.safeMetadata,
    previousEventHash: input.previousEventHash,
  };
  return { ...normalized, eventHash: digest(normalized) };
}

export function verifyAuditChain(events: readonly AuditEvent[]): boolean {
  return events.every((event, index) => {
    const { eventHash, ...input } = event;
    const expectedPrevious = index === 0 ? event.previousEventHash : events[index - 1].eventHash;
    return event.previousEventHash === expectedPrevious && digest(input) === eventHash;
  });
}
