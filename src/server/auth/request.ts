import type postgres from "postgres";

import { readSession } from "./session";
import type { AuthenticatedAccount } from "./types";

export class AuthenticationError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export async function authenticateSession(
  sql: postgres.Sql,
  token: string | undefined,
  secret: string,
): Promise<AuthenticatedAccount> {
  if (!token) throw new AuthenticationError("AUTHENTICATION_REQUIRED", "Authentication is required", 401);
  let session: AuthenticatedAccount;
  try {
    session = await readSession(token, secret);
  } catch {
    throw new AuthenticationError("SESSION_INVALID", "The session is invalid or expired", 401);
  }
  const [account] = await sql<AuthenticatedAccount[]>`
    select id as "accountId", role, status from accounts where id = ${session.accountId}
  `;
  if (!account || account.status !== "ACTIVE") {
    throw new AuthenticationError("ACCESS_DENIED", "The account is not approved", 403);
  }
  return account;
}
