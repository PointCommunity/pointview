import { NextRequest } from "next/server";

import { csrfCookie, verifyCsrfRequest } from "@/server/auth/csrf";
import { authenticateSession } from "@/server/auth/request";
import { sessionCookie } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { sqlClient } from "@/server/db/client";
import { getFeedback, withdrawFeedback } from "@/server/feedback/service";
import { presentFeedback } from "@/server/feedback/presenter";
import { feedbackRateLimiter } from "@/server/http/limits";
import { problem, withCorrelationId } from "@/server/http/problem";
import { rateLimitHeaders } from "@/server/http/rate-limit";
import { routeError } from "@/server/http/route-error";
import { FileAttachmentStore } from "@/server/storage/file-store";

type Context = { params: Promise<{ feedbackId: string }> };

export async function GET(request: NextRequest, context: Context) {
  const correlationId = withCorrelationId(request.headers);
  try {
    const config = serverConfig();
    const account = await authenticateSession(sqlClient(), request.cookies.get(sessionCookie.name)?.value, config.sessionSecret);
    const rate = feedbackRateLimiter.consume(`read:${account.accountId}`);
    if (!rate.allowed) {
      const response = problem({ status: 429, title: "Too many feedback requests", code: "RATE_LIMITED" }, correlationId);
      for (const [name, value] of Object.entries(rateLimitHeaders(rate))) response.headers.set(name, String(value));
      return response;
    }
    const { feedbackId } = await context.params;
    const record = await getFeedback(sqlClient(), { ...account, feedbackId });
    return Response.json(presentFeedback(record), { headers: { "cache-control": "private, no-store", "x-correlation-id": correlationId, ...rateLimitHeaders(rate) } });
  } catch (error) {
    return routeError(error, correlationId);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const correlationId = withCorrelationId(request.headers);
  try {
    const config = serverConfig();
    const sql = sqlClient();
    const account = await authenticateSession(sql, request.cookies.get(sessionCookie.name)?.value, config.sessionSecret);
    verifyCsrfRequest(request.headers, config.baseUrl.origin, request.cookies.get(csrfCookie.name)?.value);
    const rate = feedbackRateLimiter.consume(`write:${account.accountId}`);
    if (!rate.allowed) {
      const response = problem({ status: 429, title: "Too many feedback requests", code: "RATE_LIMITED" }, correlationId);
      for (const [name, value] of Object.entries(rateLimitHeaders(rate))) response.headers.set(name, String(value));
      return response;
    }
    const { feedbackId } = await context.params;
    await withdrawFeedback(sql, {
      ...account,
      feedbackId,
      correlationId,
      store: new FileAttachmentStore(config.attachmentRoot),
    });
    return new Response(null, { status: 204, headers: { "cache-control": "no-store", "x-correlation-id": correlationId, ...rateLimitHeaders(rate) } });
  } catch (error) {
    return routeError(error, correlationId);
  }
}
