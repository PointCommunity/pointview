import { createHash } from "node:crypto";

import { EncryptJWT, jwtDecrypt } from "jose";
import { z } from "zod";

import { accountStatuses, roles, type AuthenticatedAccount } from "./types";

const sessionSchema = z.object({
  accountId: z.uuid(),
  role: z.enum(roles),
  status: z.enum(accountStatuses),
});

function encryptionKey(secret: string): Uint8Array {
  if (secret.length < 32) throw new Error("Session secret must contain at least 32 characters");
  return createHash("sha256").update(secret).digest();
}

export async function createSession(
  account: AuthenticatedAccount,
  secret: string,
  options: { now?: Date; lifetimeSeconds?: number } = {},
): Promise<string> {
  const now = options.now ?? new Date();
  const lifetimeSeconds = options.lifetimeSeconds ?? 8 * 60 * 60;
  const issuedAt = Math.floor(now.getTime() / 1_000);
  return new EncryptJWT(account)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "JWT" })
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + lifetimeSeconds)
    .setAudience("pointview-session")
    .encrypt(encryptionKey(secret));
}

export async function readSession(token: string, secret: string, now = new Date()): Promise<AuthenticatedAccount> {
  const { payload } = await jwtDecrypt(token, encryptionKey(secret), {
    audience: "pointview-session",
    currentDate: now,
    clockTolerance: 0,
  });
  return sessionSchema.parse(payload);
}

export const sessionCookie = {
  name: "__Host-pointview_session",
  options: {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 8 * 60 * 60,
  },
};

