import { NextRequest, NextResponse } from "next/server";

import { findOrCreateAccount } from "@/server/accounts/service";
import { verifyRemoteAccessAssertion } from "@/server/auth/access";
import { createCsrfToken, csrfCookie } from "@/server/auth/csrf";
import { createSession, sessionCookie } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { sqlClient } from "@/server/db/client";
import { launchRateLimiter } from "@/server/http/limits";
import { problem, withCorrelationId } from "@/server/http/problem";
import { rateLimitHeaders } from "@/server/http/rate-limit";
import { createLaunchCookieValue, launchCookie } from "@/server/launch/cookie";
import { consumeVerifiedLaunch, findRegisteredLaunchSource } from "@/server/launch/repository";
import { verifySourceLaunch } from "@/server/launch/verify";

export async function POST(request: NextRequest) {
  const correlationId = withCorrelationId(request.headers);
  const config = serverConfig();
  const accessAssertion = request.headers.get("cf-access-jwt-assertion");
  if (!accessAssertion) return problem({ status: 401, title: "Cloudflare Access authentication is required", code: "ACCESS_ASSERTION_MISSING" }, correlationId);

  let identity;
  try {
    identity = await verifyRemoteAccessAssertion(accessAssertion, config.access);
  } catch {
    return problem({ status: 401, title: "Cloudflare Access authentication failed", code: "ACCESS_ASSERTION_INVALID" }, correlationId);
  }

  const sql = sqlClient();
  const account = await findOrCreateAccount(sql, identity, config.sessionSecret);
  if (account.status !== "ACTIVE") {
    return problem({ status: 403, title: "This PointView account is awaiting approval", code: "ACCOUNT_PENDING" }, correlationId);
  }
  const rate = launchRateLimiter.consume(account.id);
  if (!rate.allowed) {
    const response = problem({ status: 429, title: "Too many launch attempts", code: "RATE_LIMITED" }, correlationId);
    for (const [name, value] of Object.entries(rateLimitHeaders(rate))) response.headers.set(name, String(value));
    return response;
  }

  let launchToken: string;
  try {
    const form = await request.formData();
    const candidate = form.get("launch_token");
    if (typeof candidate !== "string") throw new Error("missing");
    launchToken = candidate;
  } catch {
    return problem({ status: 400, title: "A valid launch assertion is required", code: "LAUNCH_ASSERTION_REQUIRED" }, correlationId);
  }

  try {
    const verified = await verifySourceLaunch(launchToken, {
      requestOrigin: request.headers.get("origin"),
      findSource: (slug) => findRegisteredLaunchSource(sql, slug),
      consumeLaunch: (sourceSlug, launch) => consumeVerifiedLaunch(sql, {
        accountId: account.id,
        sourceSlug,
        launch,
        nonceSecret: config.sessionSecret,
        correlationId,
      }),
    });
    const [session, launchSession, csrf] = await Promise.all([
      createSession({ accountId: account.id, role: account.role, status: account.status }, config.sessionSecret),
      createLaunchCookieValue({ accountId: account.id, launchSessionId: verified.launchSessionId }, config.sessionSecret),
      Promise.resolve(createCsrfToken()),
    ]);
    const response = NextResponse.redirect(new URL("/feedback/new", config.baseUrl), 303);
    response.cookies.set(sessionCookie.name, session, sessionCookie.options);
    response.cookies.set(launchCookie.name, launchSession, launchCookie.options);
    response.cookies.set(csrfCookie.name, csrf, csrfCookie.options);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-correlation-id", correlationId);
    for (const [name, value] of Object.entries(rateLimitHeaders(rate))) response.headers.set(name, String(value));
    return response;
  } catch {
    return problem({ status: 400, title: "The product launch could not be verified", code: "LAUNCH_INVALID" }, correlationId);
  }
}
