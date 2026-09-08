import { createHmac } from "node:crypto";

import type postgres from "postgres";

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
  input: { actorRole: Role; accountId: string; expectedVersion: number; role: Role; status: AccountStatus },
): Promise<AccountRecord> {
  return withAdvisoryTransaction(sql, advisoryLocks.firstOwner, async (tx) => {
    const [current] = await tx<AccountRecord[]>`
      select id, email_normalized::text as email, display_name as "displayName", role, status, version
      from accounts where id = ${input.accountId} for update
    `;
    if (!current) throw new Error("Account not found");
    if (current.version !== input.expectedVersion) throw new Error("Account version conflict");
    const [{ count: activeOwnerCount }] = await tx<{ count: number }[]>`
      select count(*)::int as count from accounts where role = 'OWNER' and status = 'ACTIVE'
    `;
    validateAccountTransition({
      actorRole: input.actorRole,
      currentRole: current.role,
      currentStatus: current.status,
      nextRole: input.role,
      nextStatus: input.status,
      activeOwnerCount,
    });
    const [updated] = await tx<AccountRecord[]>`
      update accounts
      set role = ${input.role}, status = ${input.status}, version = version + 1,
          approved_at = case when ${input.status} = 'ACTIVE' then coalesce(approved_at, now()) else approved_at end,
          suspended_at = case when ${input.status} = 'SUSPENDED' then now() else null end
      where id = ${input.accountId} and version = ${input.expectedVersion}
      returning id, email_normalized::text as email, display_name as "displayName", role, status, version
    `;
    if (!updated) throw new Error("Account version conflict");
    return updated;
  });
}

