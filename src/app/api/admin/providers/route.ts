import { NextRequest } from "next/server";

import { authenticateSession } from "@/server/auth/request";
import { sessionCookie } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { sqlClient } from "@/server/db/client";
import { routeError } from "@/server/http/route-error";
import { withCorrelationId } from "@/server/http/problem";
import { listProviderConnections } from "@/server/providers/repository";

export async function GET(request: NextRequest) {
  const correlationId = withCorrelationId(request.headers);
  try {
    const config = serverConfig();
    const account = await authenticateSession(sqlClient(), request.cookies.get(sessionCookie.name)?.value, config.sessionSecret);
    const connections = await listProviderConnections(sqlClient(), account);
    return Response.json(connections, { headers: { "cache-control": "private, no-store", "x-correlation-id": correlationId } });
  } catch (error) { return routeError(error, correlationId); }
}
