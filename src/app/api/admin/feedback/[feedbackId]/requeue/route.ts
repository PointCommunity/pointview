import { NextRequest } from "next/server";

import { csrfCookie, verifyCsrfRequest } from "@/server/auth/csrf";
import { authenticateSession } from "@/server/auth/request";
import { sessionCookie } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { sqlClient } from "@/server/db/client";
import { withCorrelationId } from "@/server/http/problem";
import { routeError } from "@/server/http/route-error";
import { requeueFeedback } from "@/server/triage/requeue";

type Context = { params: Promise<{ feedbackId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const correlationId = withCorrelationId(request.headers);
  try {
    const config = serverConfig();
    const account = await authenticateSession(sqlClient(), request.cookies.get(sessionCookie.name)?.value, config.sessionSecret);
    verifyCsrfRequest(request.headers, config.baseUrl.origin, request.cookies.get(csrfCookie.name)?.value);
    const { feedbackId } = await context.params;
    const body = await request.json().catch(() => null) as { explanation?: unknown } | null;
    const result = await requeueFeedback(sqlClient(), { actor: account, feedbackId, explanation: body?.explanation, correlationId });
    return Response.json(result, { headers: { "cache-control": "private, no-store", "x-correlation-id": correlationId } });
  } catch (error) { return routeError(error, correlationId); }
}
