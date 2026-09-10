import { NextRequest } from "next/server";

import { csrfCookie, verifyCsrfRequest } from "@/server/auth/csrf";
import { authenticateSession } from "@/server/auth/request";
import { sessionCookie } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { sqlClient } from "@/server/db/client";
import { GitHubAppClient } from "@/server/github/client";
import { administrationRateLimiter } from "@/server/http/limits";
import { problem, withCorrelationId } from "@/server/http/problem";
import { rateLimitHeaders } from "@/server/http/rate-limit";
import { routeError } from "@/server/http/route-error";
import { validateGitHubSourceTarget } from "@/server/source-apps/github-validation";
import { presentSourceApp, sourceInputFromApi } from "@/server/source-apps/presenter";
import { SourceAppError, updateSourceApp } from "@/server/source-apps/service";

type Context = { params: Promise<{ sourceAppId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const correlationId = withCorrelationId(request.headers);
  try {
    const config = serverConfig();
    const account = await authenticateSession(sqlClient(), request.cookies.get(sessionCookie.name)?.value, config.sessionSecret);
    verifyCsrfRequest(request.headers, config.baseUrl.origin, request.cookies.get(csrfCookie.name)?.value);
    const rate = administrationRateLimiter.consume(`write:${account.accountId}`);
    if (!rate.allowed) {
      const response = problem({ status: 429, title: "Too many administration requests", code: "RATE_LIMITED" }, correlationId);
      for (const [name, value] of Object.entries(rateLimitHeaders(rate))) response.headers.set(name, String(value));
      return response;
    }
    const match = request.headers.get("if-match")?.replaceAll('"', "");
    const expectedVersion = Number(match);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new SourceAppError("IF_MATCH_REQUIRED", "A valid If-Match version is required", 412);
    const body = await request.json().catch(() => { throw new SourceAppError("SOURCE_INPUT_INVALID", "JSON body is invalid", 400); });
    const input = sourceInputFromApi(body);
    const { sourceAppId } = await context.params;
    const source = await updateSourceApp(sqlClient(), {
      actor: account,
      sourceAppId,
      expectedVersion,
      input,
      correlationId,
      validateTarget: async (candidate) => validateGitHubSourceTarget(new GitHubAppClient({
        appId: config.github.appId,
        installationId: candidate.githubInstallationId,
        privateKeyPem: config.github.privateKey,
        allowedRepositories: new Set([`${candidate.githubOwner}/${candidate.githubRepo}`]),
      }), candidate),
    });
    return Response.json(presentSourceApp(source), { headers: { etag: `"${source.version}"`, "cache-control": "private, no-store", "x-correlation-id": correlationId, ...rateLimitHeaders(rate) } });
  } catch (error) {
    return routeError(error, correlationId);
  }
}
