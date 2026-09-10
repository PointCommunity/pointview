import { NextRequest, NextResponse } from "next/server";

import { findOrCreateAccount } from "@/server/accounts/service";
import { verifyRemoteAccessAssertion } from "@/server/auth/access";
import { createCsrfToken, csrfCookie } from "@/server/auth/csrf";
import { createSession, sessionCookie } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { sqlClient } from "@/server/db/client";
import { problem, withCorrelationId } from "@/server/http/problem";

export async function POST(request: NextRequest) {
  const correlationId = withCorrelationId(request.headers);
  const config = serverConfig();
  const accessAssertion = request.headers.get("cf-access-jwt-assertion");
  if (!accessAssertion) {
    return problem({ status: 401, title: "Cloudflare Access authentication is required", code: "ACCESS_ASSERTION_MISSING" }, correlationId);
  }

  let identity;
  try {
    identity = await verifyRemoteAccessAssertion(accessAssertion, config.access);
  } catch {
    return problem({ status: 401, title: "Cloudflare Access authentication failed", code: "ACCESS_ASSERTION_INVALID" }, correlationId);
  }

  try {
    const account = await findOrCreateAccount(sqlClient(), identity, config.sessionSecret);
    if (account.role !== "OWNER" || account.status !== "ACTIVE") {
      return problem({ status: 403, title: "Owner access is required", code: "OWNER_ACCESS_REQUIRED" }, correlationId);
    }
    const [session, csrf] = await Promise.all([
      createSession({ accountId: account.id, role: account.role, status: account.status }, config.sessionSecret),
      Promise.resolve(createCsrfToken()),
    ]);
    const response = NextResponse.redirect(new URL("/admin/settings", config.baseUrl), 303);
    response.cookies.set(sessionCookie.name, session, sessionCookie.options);
    response.cookies.set(csrfCookie.name, csrf, csrfCookie.options);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-correlation-id", correlationId);
    return response;
  } catch {
    return problem({ status: 500, title: "Owner sign-in could not be completed", code: "BOOTSTRAP_FAILED" }, correlationId);
  }
}
