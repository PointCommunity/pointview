import { NextRequest } from "next/server";

import { csrfCookie, verifyCsrfRequest } from "@/server/auth/csrf";
import { authenticateSession } from "@/server/auth/request";
import { sessionCookie } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { sqlClient } from "@/server/db/client";
import { administrationRateLimiter } from "@/server/http/limits";
import { problem, withCorrelationId } from "@/server/http/problem";
import { routeError } from "@/server/http/route-error";
import { discoverCodexCatalog } from "@/server/providers/codex/authorization";
import { providerName } from "@/server/providers/credentials";
import { discoverOllamaModels } from "@/server/providers/ollama";
import { listProviderConnections, loadProviderCredential, saveConnectedProvider } from "@/server/providers/repository";

export async function POST(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const correlationId = withCorrelationId(request.headers);
  try {
    const config = serverConfig();
    const account = await authenticateSession(sqlClient(), request.cookies.get(sessionCookie.name)?.value, config.sessionSecret);
    verifyCsrfRequest(request.headers, config.baseUrl.origin, request.cookies.get(csrfCookie.name)?.value);
    const rate = administrationRateLimiter.consume(`providers:refresh:${account.accountId}`);
    if (!rate.allowed) return problem({ status: 429, title: "Too many provider requests", code: "RATE_LIMITED" }, correlationId);
    const provider = providerName.parse((await context.params).provider);
    const expectedVersion = Number(request.headers.get("if-match")?.replaceAll('"', ""));
    await listProviderConnections(sqlClient(), account);
    const storedCredential = await loadProviderCredential(sqlClient(), provider, config.credentialEncryptionKey);
    const discovered = provider === "OLLAMA_CLOUD"
      ? { models: await discoverOllamaModels(storedCredential), refreshedCredential: storedCredential }
      : await discoverCodexCatalog(storedCredential);
    const connection = await saveConnectedProvider(sqlClient(), {
      actor: account, provider, credential: discovered.refreshedCredential, encryptionKey: config.credentialEncryptionKey,
      planType: provider === "OLLAMA_CLOUD" ? "Ollama Cloud" : "ChatGPT", models: discovered.models,
      correlationId, expectedVersion,
    });
    return Response.json(connection, { headers: { "cache-control": "private, no-store", "x-correlation-id": correlationId } });
  } catch (error) { return routeError(error, correlationId); }
}
