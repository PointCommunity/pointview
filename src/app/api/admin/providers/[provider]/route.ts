import { NextRequest } from "next/server";

import { csrfCookie, verifyCsrfRequest } from "@/server/auth/csrf";
import { authenticateSession } from "@/server/auth/request";
import { sessionCookie } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { sqlClient } from "@/server/db/client";
import { routeError } from "@/server/http/route-error";
import { withCorrelationId } from "@/server/http/problem";
import { providerName } from "@/server/providers/credentials";
import { disconnectProvider } from "@/server/providers/repository";

export async function DELETE(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const correlationId = withCorrelationId(request.headers);
  try {
    const config = serverConfig();
    const account = await authenticateSession(sqlClient(), request.cookies.get(sessionCookie.name)?.value, config.sessionSecret);
    verifyCsrfRequest(request.headers, config.baseUrl.origin, request.cookies.get(csrfCookie.name)?.value);
    const provider = providerName.parse((await context.params).provider);
    const expectedVersion = Number(request.headers.get("if-match")?.replaceAll('"', ""));
    await disconnectProvider(sqlClient(), { actor: account, provider, expectedVersion, correlationId });
    return new Response(null, { status: 204, headers: { "cache-control": "no-store", "x-correlation-id": correlationId } });
  } catch (error) { return routeError(error, correlationId); }
}
