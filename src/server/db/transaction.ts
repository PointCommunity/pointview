import type postgres from "postgres";

export const advisoryLocks = {
  firstOwner: 0x50564f57,
  triageBatch: 0x50565452,
} as const;

export async function withAdvisoryTransaction<T>(
  sql: postgres.Sql,
  lockId: number,
  work: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${lockId})`;
    return work(tx);
  }) as Promise<T>;
}
