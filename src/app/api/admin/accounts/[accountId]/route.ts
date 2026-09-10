import { NextRequest } from "next/server";
import { z } from "zod";

import { AccountError, updateAccount } from "@/server/accounts/service";
import { csrfCookie, verifyCsrfRequest } from "@/server/auth/csrf";
import { authenticateSession } from "@/server/auth/request";
import { sessionCookie } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { sqlClient } from "@/server/db/client";
import { administrationRateLimiter } from "@/server/http/limits";
import { problem, withCorrelationId } from "@/server/http/problem";
import { rateLimitHeaders } from "@/server/http/rate-limit";
import { routeError } from "@/server/http/route-error";

const bodySchema = z.object({ role: z.enum(["USER", "ADMIN", "OWNER"]), status: z.enum(["PENDING", "ACTIVE", "SUSPENDED"]) }).strict();
type Context = { params: Promise<{ accountId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const correlationId = withCorrelationId(request.headers);
  try {
    const config = serverConfig();
    const account = await authenticateSession(sqlClient(), request.cookies.get(sessionCookie.name)?.value, config.sessionSecret);
    verifyCsrfRequest(request.headers, config.baseUrl.origin, request.cookies.get(csrfCookie.name)?.value);
    const rate = administrationRateLimiter.consume(`accounts:write:${account.accountId}`);
    if (!rate.allowed) return problem({ status: 429, title: "Too many administration requests", code: "RATE_LIMITED" }, correlationId);
    const version = Number(request.headers.get("if-match")?.replaceAll('"', ""));
    if (!Number.isInteger(version) || version < 1) throw new AccountError("IF_MATCH_REQUIRED", "A valid If-Match version is required", 412);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AccountError("ACCOUNT_INPUT_INVALID", "Account update is invalid", 400);
    const { accountId } = await context.params;
    const updated = await updateAccount(sqlClient(), {
      actorRole: account.role,
      actorAccountId: account.accountId,
      correlationId,
      accountId,
      expectedVersion: version,
      ...parsed.data,
    });
    return Response.json(updated, { headers: { etag: `"${updated.version}"`, "cache-control": "private, no-store", "x-correlation-id": correlationId, ...rateLimitHeaders(rate) } });
  } catch (error) {
    return routeError(error, correlationId);
  }
}
