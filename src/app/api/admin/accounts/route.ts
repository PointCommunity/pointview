import { NextRequest } from "next/server";

import { listAccounts } from "@/server/accounts/service";
import { authenticateSession } from "@/server/auth/request";
import { sessionCookie } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { sqlClient } from "@/server/db/client";
import { administrationRateLimiter } from "@/server/http/limits";
import { problem, withCorrelationId } from "@/server/http/problem";
import { rateLimitHeaders } from "@/server/http/rate-limit";
import { routeError } from "@/server/http/route-error";

export async function GET(request: NextRequest) {
  const correlationId = withCorrelationId(request.headers);
  try {
    const config = serverConfig();
    const account = await authenticateSession(sqlClient(), request.cookies.get(sessionCookie.name)?.value, config.sessionSecret);
    const rate = administrationRateLimiter.consume(`accounts:read:${account.accountId}`);
    if (!rate.allowed) return problem({ status: 429, title: "Too many administration requests", code: "RATE_LIMITED" }, correlationId);
    const accounts = await listAccounts(sqlClient(), account);
    return Response.json(accounts, { headers: { "cache-control": "private, no-store", "x-correlation-id": correlationId, ...rateLimitHeaders(rate) } });
  } catch (error) {
    return routeError(error, correlationId);
  }
}
