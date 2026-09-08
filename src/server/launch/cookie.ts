import { createHash } from "node:crypto";

import { EncryptJWT, jwtDecrypt } from "jose";
import { z } from "zod";

const launchCookieSchema = z.object({ accountId: z.uuid(), launchSessionId: z.uuid() });

function encryptionKey(secret: string): Uint8Array {
  if (secret.length < 32) throw new Error("Session secret must contain at least 32 characters");
  return createHash("sha256").update(`pointview-launch:${secret}`).digest();
}

export async function createLaunchCookieValue(
  value: z.infer<typeof launchCookieSchema>,
  secret: string,
  now = new Date(),
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1_000);
  return new EncryptJWT(value)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "JWT" })
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 30 * 60)
    .setAudience("pointview-launch-session")
    .encrypt(encryptionKey(secret));
}

export async function readLaunchCookieValue(value: string, secret: string, now = new Date()) {
  const { payload } = await jwtDecrypt(value, encryptionKey(secret), {
    audience: "pointview-launch-session",
    currentDate: now,
    clockTolerance: 0,
  });
  return launchCookieSchema.parse(payload);
}

export const launchCookie = {
  name: "__Host-pointview_launch",
  options: {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 30 * 60,
  },
};
