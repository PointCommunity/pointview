import { NextRequest } from "next/server";

import { csrfCookie, verifyCsrfRequest } from "@/server/auth/csrf";
import { authenticateSession } from "@/server/auth/request";
import { sessionCookie } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { sqlClient } from "@/server/db/client";
import { administrationRateLimiter } from "@/server/http/limits";
import { problem, withCorrelationId } from "@/server/http/problem";
import { rateLimitHeaders } from "@/server/http/rate-limit";
import { routeError } from "@/server/http/route-error";
import { presentSourceApp, sourceInputFromApi } from "@/server/source-apps/presenter";
import { createSourceApp, listSourceApps, SourceAppError } from "@/server/source-apps/service";

function limited(correlationId: string, rate: ReturnType<typeof administrationRateLimiter.consume>) {
  const response = problem({ status: 429, title: "Too many administration requests", code: "RATE_LIMITED" }, correlationId);
  for (const [name, value] of Object.entries(rateLimitHeaders(rate))) response.headers.set(name, String(value));
  return response;
}

export async function GET(request: NextRequest) {
  const correlationId = withCorrelationId(request.headers);
  try {
    const config = serverConfig();
    const account = await authenticateSession(sqlClient(), request.cookies.get(sessionCookie.name)?.value, config.sessionSecret);
    const rate = administrationRateLimiter.consume(`read:${account.accountId}`);
    if (!rate.allowed) return limited(correlationId, rate);
    const sources = await listSourceApps(sqlClient(), account);
    return Response.json(sources.map(presentSourceApp), { headers: { "cache-control": "private, no-store", "x-correlation-id": correlationId, ...rateLimitHeaders(rate) } });
  } catch (error) {
    return routeError(error, correlationId);
  }
}

export async function POST(request: NextRequest) {
  const correlationId = withCorrelationId(request.headers);
  try {
    const config = serverConfig();
    const account = await authenticateSession(sqlClient(), request.cookies.get(sessionCookie.name)?.value, config.sessionSecret);
    verifyCsrfRequest(request.headers, config.baseUrl.origin, request.cookies.get(csrfCookie.name)?.value);
    const rate = administrationRateLimiter.consume(`write:${account.accountId}`);
    if (!rate.allowed) return limited(correlationId, rate);
    const body = await request.json().catch(() => { throw new SourceAppError("SOURCE_INPUT_INVALID", "JSON body is invalid", 400); });
    const source = await createSourceApp(sqlClient(), { actor: account, correlationId, input: sourceInputFromApi(body) });
    return Response.json(presentSourceApp(source), { status: 201, headers: { location: `/api/admin/source-apps/${source.id}`, "cache-control": "private, no-store", "x-correlation-id": correlationId, ...rateLimitHeaders(rate) } });
  } catch (error) {
    return routeError(error, correlationId);
  }
}
