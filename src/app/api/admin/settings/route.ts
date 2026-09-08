import { NextRequest } from "next/server";

import { csrfCookie, verifyCsrfRequest } from "@/server/auth/csrf";
import { authenticateSession } from "@/server/auth/request";
import { sessionCookie } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { readSettings, SettingsError, updateSettings } from "@/server/config/settings";
import { sqlClient } from "@/server/db/client";
import { administrationRateLimiter } from "@/server/http/limits";
import { problem, withCorrelationId } from "@/server/http/problem";
import { routeError } from "@/server/http/route-error";

export async function GET(request: NextRequest) {
  const correlationId = withCorrelationId(request.headers);
  try {
    const config = serverConfig();
    const account = await authenticateSession(sqlClient(), request.cookies.get(sessionCookie.name)?.value, config.sessionSecret);
    const settings = await readSettings(sqlClient(), account);
    return Response.json(settings, { headers: { etag: `"${settings.version}"`, "cache-control": "private, no-store", "x-correlation-id": correlationId } });
  } catch (error) { return routeError(error, correlationId); }
}

export async function PUT(request: NextRequest) {
  const correlationId = withCorrelationId(request.headers);
  try {
    const config = serverConfig();
    const account = await authenticateSession(sqlClient(), request.cookies.get(sessionCookie.name)?.value, config.sessionSecret);
    verifyCsrfRequest(request.headers, config.baseUrl.origin, request.cookies.get(csrfCookie.name)?.value);
    const rate = administrationRateLimiter.consume(`settings:write:${account.accountId}`);
    if (!rate.allowed) return problem({ status: 429, title: "Too many administration requests", code: "RATE_LIMITED" }, correlationId);
    const version = Number(request.headers.get("if-match")?.replaceAll('"', ""));
    if (!Number.isInteger(version) || version < 1) throw new SettingsError("IF_MATCH_REQUIRED", "A valid If-Match version is required", 412);
    const updated = await updateSettings(sqlClient(), { actor: account, expectedVersion: version, correlationId, input: await request.json().catch(() => null) });
    return Response.json(updated, { headers: { etag: `"${updated.version}"`, "cache-control": "private, no-store", "x-correlation-id": correlationId } });
  } catch (error) { return routeError(error, correlationId); }
}
