import { NextRequest } from "next/server";
import { z } from "zod";

import { csrfCookie, verifyCsrfRequest } from "@/server/auth/csrf";
import { authenticateSession } from "@/server/auth/request";
import { sessionCookie } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { sqlClient } from "@/server/db/client";
import { administrationRateLimiter } from "@/server/http/limits";
import { problem, withCorrelationId } from "@/server/http/problem";
import { routeError } from "@/server/http/route-error";
import { startCodexAuthorization } from "@/server/providers/codex/authorization";

const input = z.object({ expectedVersion: z.number().int().min(0) }).strict();

export async function POST(request: NextRequest) {
  const correlationId = withCorrelationId(request.headers);
  try {
    const config = serverConfig();
    const account = await authenticateSession(sqlClient(), request.cookies.get(sessionCookie.name)?.value, config.sessionSecret);
    verifyCsrfRequest(request.headers, config.baseUrl.origin, request.cookies.get(csrfCookie.name)?.value);
    const rate = administrationRateLimiter.consume(`providers:codex:${account.accountId}`);
    if (!rate.allowed) return problem({ status: 429, title: "Too many provider requests", code: "RATE_LIMITED" }, correlationId);
    const parsed = input.parse(await request.json().catch(() => null));
    const authorization = await startCodexAuthorization(account, parsed.expectedVersion);
    return Response.json(authorization, { status: 201, headers: { "cache-control": "private, no-store", "x-correlation-id": correlationId } });
  } catch (error) { return routeError(error, correlationId); }
}
