import { createHmac } from "node:crypto";

import type postgres from "postgres";

import { appendAuditEventInTransaction } from "@/server/audit/repository";
import { validateAccountTransition } from "@/server/auth/policy";
import type { AccountStatus, Role } from "@/server/auth/types";
import { newId } from "@/server/db/ids";
import { advisoryLocks, withAdvisoryTransaction } from "@/server/db/transaction";

export type AccountRecord = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: AccountStatus;
  version: number;
};

export class AccountError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "AccountError";
  }
}

type AccessIdentity = { subject: string; email: string; displayName: string };

function subjectHash(subject: string, secret: string): string {
  return createHmac("sha256", secret).update(subject).digest("hex");
}

function selectAccount(tx: postgres.TransactionSql, hash: string) {
  return tx<AccountRecord[]>`
    select id, email_normalized::text as email, display_name as "displayName", role, status, version
    from accounts where access_subject_hash = ${hash}
  `;
}

export async function findOrCreateAccount(sql: postgres.Sql, identity: AccessIdentity, hashSecret: string): Promise<AccountRecord> {
  const hash = subjectHash(identity.subject, hashSecret);
  return withAdvisoryTransaction(sql, advisoryLocks.firstOwner, async (tx) => {
    const existing = (await selectAccount(tx, hash))[0];
    if (existing) {
      await tx`update accounts set last_seen_at = now() where id = ${existing.id}`;
      return existing;
    }
    const [{ count }] = await tx<{ count: number }[]>`select count(*)::int as count from accounts`;
    const first = count === 0;
    const id = newId();
    const role: Role = first ? "OWNER" : "USER";
    const status: AccountStatus = first ? "ACTIVE" : "PENDING";
    const [created] = await tx<AccountRecord[]>`
      insert into accounts (id, access_subject_hash, email_normalized, display_name, role, status, approved_at, last_seen_at)
      values (${id}, ${hash}, ${identity.email.toLowerCase()}, ${identity.displayName}, ${role}, ${status}, ${first ? new Date() : null}, now())
      returning id, email_normalized::text as email, display_name as "displayName", role, status, version
    `;
    return created;
  });
}

export async function updateAccount(
  sql: postgres.Sql,
  input: { actorRole: Role; actorAccountId?: string; correlationId?: string; accountId: string; expectedVersion: number; role: Role; status: AccountStatus },
): Promise<AccountRecord> {
  return withAdvisoryTransaction(sql, advisoryLocks.firstOwner, async (tx) => {
    const [current] = await tx<AccountRecord[]>`
      select id, email_normalized::text as email, display_name as "displayName", role, status, version
      from accounts where id = ${input.accountId} for update
    `;
    if (!current) throw new AccountError("ACCOUNT_NOT_FOUND", "Account not found", 404);
    if (current.version !== input.expectedVersion) throw new AccountError("ACCOUNT_VERSION_CONFLICT", "Account version conflict", 412);
    const [{ count: activeOwnerCount }] = await tx<{ count: number }[]>`
      select count(*)::int as count from accounts where role = 'OWNER' and status = 'ACTIVE'
    `;
    try {
      validateAccountTransition({
        actorRole: input.actorRole,
        currentRole: current.role,
        currentStatus: current.status,
        nextRole: input.role,
        nextStatus: input.status,
        activeOwnerCount,
      });
    } catch (error) {
      throw new AccountError("ACCOUNT_TRANSITION_DENIED", error instanceof Error ? error.message : "Account transition denied", 403);
    }
    const [updated] = await tx<AccountRecord[]>`
      update accounts
      set role = ${input.role}, status = ${input.status}, version = version + 1,
          approved_at = case when ${input.status} = 'ACTIVE' then coalesce(approved_at, now()) else approved_at end,
          suspended_at = case when ${input.status} = 'SUSPENDED' then now() else null end
      where id = ${input.accountId} and version = ${input.expectedVersion}
      returning id, email_normalized::text as email, display_name as "displayName", role, status, version
    `;
    if (!updated) throw new AccountError("ACCOUNT_VERSION_CONFLICT", "Account version conflict", 412);
    if (input.actorAccountId && input.correlationId) {
      await appendAuditEventInTransaction(tx, {
        id: newId(), eventAt: new Date().toISOString(), actorType: "ACCOUNT", actorId: input.actorAccountId,
        action: "account.updated", targetType: "account", targetId: input.accountId, result: "SUCCESS",
        correlationId: input.correlationId,
        safeMetadata: { previousRole: current.role, previousStatus: current.status, role: updated.role, status: updated.status, version: updated.version },
      });
    }
    return updated;
  });
}

export async function listAccounts(sql: postgres.Sql, actor: { role: Role; status: AccountStatus }): Promise<AccountRecord[]> {
  if (actor.status !== "ACTIVE" || actor.role === "USER") throw new AccountError("ACCESS_DENIED", "Only Admins and Owners may view accounts", 403);
  return sql<AccountRecord[]>`
    select id, email_normalized::text as email, display_name as "displayName", role, status, version
    from accounts order by created_at, id
  `;
}
