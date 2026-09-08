import type { BrowserContext } from "@playwright/test";

import { createSession, sessionCookie } from "../src/server/auth/session";
import { csrfCookie } from "../src/server/auth/csrf";
import { createLaunchCookieValue, launchCookie } from "../src/server/launch/cookie";

export const fixtureIds = {
  owner: "018f4f6d-7c00-7000-8000-000000000100",
  admin: "018f4f6d-7c00-7000-8000-000000000101",
  user: "018f4f6d-7c00-7000-8000-000000000102",
  pending: "018f4f6d-7c00-7000-8000-000000000103",
  launchNew: "018f4f6d-7c00-7000-8000-000000000300",
  queued: "018f4f6d-7c00-7000-8000-000000000400",
  attention: "018f4f6d-7c00-7000-8000-000000000401",
  triaged: "018f4f6d-7c00-7000-8000-000000000402",
};

const secret = "ci-only-session-secret-at-least-32-characters";
const csrf = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function authenticate(context: BrowserContext, accountId: string, role: "USER" | "ADMIN" | "OWNER", includeLaunch = false) {
  const cookies = [
    { name: sessionCookie.name, value: await createSession({ accountId, role, status: "ACTIVE" }, secret), url: "https://127.0.0.1:3210", httpOnly: true, secure: true, sameSite: "Lax" as const },
    { name: csrfCookie.name, value: csrf, url: "https://127.0.0.1:3210", httpOnly: false, secure: true, sameSite: "Lax" as const },
  ];
  if (includeLaunch) cookies.push({ name: launchCookie.name, value: await createLaunchCookieValue({ accountId, launchSessionId: fixtureIds.launchNew }, secret), url: "https://127.0.0.1:3210", httpOnly: true, secure: true, sameSite: "Lax" as const });
  await context.addCookies(cookies);
}
