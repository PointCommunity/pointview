import { randomBytes, timingSafeEqual } from "node:crypto";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export class CsrfError extends Error {
  readonly code = "CSRF_INVALID";
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "CsrfError";
  }
}

export function createCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

function sameToken(left: string, right: string): boolean {
  if (!tokenPattern.test(left) || !tokenPattern.test(right)) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export function verifyCsrfRequest(headers: Headers, expectedOrigin: string, cookieToken: string | undefined): void {
  const origin = headers.get("origin");
  if (!origin || origin !== new URL(expectedOrigin).origin) throw new CsrfError("Mutation origin is not allowed");
  const headerToken = headers.get("x-csrf-token");
  if (!headerToken || !cookieToken || !sameToken(headerToken, cookieToken)) throw new CsrfError("CSRF token is invalid");
}

export const csrfCookie = {
  name: "__Host-pointview_csrf",
  options: {
    httpOnly: false,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 8 * 60 * 60,
  },
};
