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
import { discoverOllamaModels } from "@/server/providers/ollama";
import { listProviderConnections, saveConnectedProvider } from "@/server/providers/repository";

const input = z.object({ apiKey: z.string().trim().min(1).max(5000), expectedVersion: z.number().int().min(0) }).strict();

export async function POST(request: NextRequest) {
  const correlationId = withCorrelationId(request.headers);
  try {
    const config = serverConfig();
    const account = await authenticateSession(sqlClient(), request.cookies.get(sessionCookie.name)?.value, config.sessionSecret);
    verifyCsrfRequest(request.headers, config.baseUrl.origin, request.cookies.get(csrfCookie.name)?.value);
    const rate = administrationRateLimiter.consume(`providers:ollama:${account.accountId}`);
    if (!rate.allowed) return problem({ status: 429, title: "Too many provider requests", code: "RATE_LIMITED" }, correlationId);
    const parsed = input.parse(await request.json().catch(() => null));
    await listProviderConnections(sqlClient(), account);
    const models = await discoverOllamaModels(parsed.apiKey);
    const connection = await saveConnectedProvider(sqlClient(), {
      actor: account, provider: "OLLAMA_CLOUD", credential: parsed.apiKey,
      encryptionKey: config.credentialEncryptionKey, planType: "Ollama Cloud", models,
      correlationId, expectedVersion: parsed.expectedVersion,
    });
    return Response.json(connection, { headers: { "cache-control": "private, no-store", "x-correlation-id": correlationId } });
  } catch (error) { return routeError(error, correlationId); }
}
