import { NextRequest } from "next/server";
import { z } from "zod";

import { csrfCookie, verifyCsrfRequest } from "@/server/auth/csrf";
import { authenticateSession } from "@/server/auth/request";
import { sessionCookie } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { sqlClient } from "@/server/db/client";
import { routeError } from "@/server/http/route-error";
import { withCorrelationId } from "@/server/http/problem";
import { finishCodexAuthorization } from "@/server/providers/codex/authorization";

const input = z.object({ sessionId: z.string().uuid() }).strict();

export async function POST(request: NextRequest) {
  const correlationId = withCorrelationId(request.headers);
  try {
    const config = serverConfig();
    const account = await authenticateSession(sqlClient(), request.cookies.get(sessionCookie.name)?.value, config.sessionSecret);
    verifyCsrfRequest(request.headers, config.baseUrl.origin, request.cookies.get(csrfCookie.name)?.value);
    const parsed = input.parse(await request.json().catch(() => null));
    const result = await finishCodexAuthorization(sqlClient(), {
      actor: account, sessionId: parsed.sessionId, encryptionKey: config.credentialEncryptionKey, correlationId,
    });
    return Response.json(result, { headers: { "cache-control": "private, no-store", "x-correlation-id": correlationId } });
  } catch (error) { return routeError(error, correlationId); }
}
