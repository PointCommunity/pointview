import { createHash } from "node:crypto";

import type postgres from "postgres";

import { newId } from "@/server/db/ids";

import type { OperationLedger, OperationRecord } from "./apply-decision";

export type GitHubOperationStep = "COMMENT" | "CREATE_ISSUE" | "ADD_PROJECT_ITEM" | "SET_FIELD" | "SET_LABELS" | "READBACK";

type OperationContext = {
  decisionId: string;
  step: GitHubOperationStep;
  target: unknown;
  payload: unknown;
  preconditions: unknown;
};

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

type StoredOperation = {
  state: OperationRecord["state"];
  githubIssueNumber: number | null;
  githubNodeId: string | null;
  readback: unknown;
  targetDigest: string;
  payloadDigest: string;
  preconditionSnapshot: unknown;
};

export class PostgresOperationLedger implements OperationLedger {
  constructor(readonly sql: postgres.Sql, readonly context: OperationContext) {}

  async #stored(key: string): Promise<StoredOperation | undefined> {
    const [row] = await this.sql<StoredOperation[]>`
      select state, github_issue_number as "githubIssueNumber", github_node_id as "githubNodeId",
        readback_payload as readback, target_digest as "targetDigest", payload_digest as "payloadDigest",
        precondition_snapshot as "preconditionSnapshot"
      from github_operations where idempotency_key = ${key}
    `;
    return row;
  }

  async get(key: string): Promise<OperationRecord | undefined> {
    const row = await this.#stored(key);
    if (!row) return undefined;
    return {
      key,
      state: row.state,
      githubIssueNumber: row.githubIssueNumber ?? undefined,
      githubCommentId: row.githubNodeId ?? undefined,
      readback: row.readback ?? undefined,
    };
  }

  async put(record: OperationRecord): Promise<void> {
    const targetDigest = digest(this.context.target);
    const payloadDigest = digest(this.context.payload);
    await this.sql`
      insert into github_operations (
        id, decision_id, step, idempotency_key, target_digest, payload_digest, precondition_snapshot, state,
        github_node_id, github_issue_number, readback_digest, readback_payload, readback_at
      ) values (
        ${newId()}, ${this.context.decisionId}, ${this.context.step}, ${record.key}, ${targetDigest}, ${payloadDigest},
        ${this.sql.json(this.context.preconditions as postgres.JSONValue)}, 'PENDING', ${record.githubCommentId ?? null},
        ${record.githubIssueNumber ?? null}, null, null, null
      ) on conflict (idempotency_key) do nothing
    `;
    const existing = await this.#stored(record.key);
    if (!existing || existing.targetDigest !== targetDigest || existing.payloadDigest !== payloadDigest || canonical(existing.preconditionSnapshot) !== canonical(this.context.preconditions)) {
      throw new Error("GitHub operation idempotency payload or precondition drift detected");
    }
    if (existing.state === "CONFIRMED" && record.state !== "CONFIRMED") return;
    await this.sql`
      update github_operations set state = ${record.state},
        github_node_id = coalesce(${record.githubCommentId ?? null}, github_node_id),
        github_issue_number = coalesce(${record.githubIssueNumber ?? null}, github_issue_number),
        readback_digest = ${record.readback === undefined ? existing.readback === undefined ? null : digest(existing.readback) : digest(record.readback)},
        readback_payload = ${record.readback === undefined ? existing.readback === undefined ? null : this.sql.json(existing.readback as postgres.JSONValue) : this.sql.json(record.readback as postgres.JSONValue)},
        readback_at = case when ${record.state} = 'CONFIRMED' then coalesce(readback_at, now()) else readback_at end,
        updated_at = now()
      where idempotency_key = ${record.key}
    `;
  }
}
