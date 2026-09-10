import { NextRequest } from "next/server";

import { authenticateSession } from "@/server/auth/request";
import { sessionCookie } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { sqlClient } from "@/server/db/client";
import { authorizeAttachment } from "@/server/feedback/service";
import { attachmentRateLimiter } from "@/server/http/limits";
import { problem, withCorrelationId } from "@/server/http/problem";
import { rateLimitHeaders } from "@/server/http/rate-limit";
import { routeError } from "@/server/http/route-error";
import { FileAttachmentStore } from "@/server/storage/file-store";

type Context = { params: Promise<{ feedbackId: string; attachmentId: string }> };

export async function GET(request: NextRequest, context: Context) {
  const correlationId = withCorrelationId(request.headers);
  try {
    const config = serverConfig();
    const sql = sqlClient();
    const account = await authenticateSession(sql, request.cookies.get(sessionCookie.name)?.value, config.sessionSecret);
    const rate = attachmentRateLimiter.consume(account.accountId);
    if (!rate.allowed) {
      const response = problem({ status: 429, title: "Too many screenshot requests", code: "RATE_LIMITED" }, correlationId);
      for (const [name, value] of Object.entries(rateLimitHeaders(rate))) response.headers.set(name, String(value));
      return response;
    }
    const { feedbackId, attachmentId } = await context.params;
    const attachment = await authorizeAttachment(sql, { ...account, feedbackId, attachmentId });
    const bytes = await new FileAttachmentStore(config.attachmentRoot).read(attachment.storageKey);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": attachment.mimeType,
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.displayName)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "x-correlation-id": correlationId,
        ...rateLimitHeaders(rate),
      },
    });
  } catch (error) {
    return routeError(error, correlationId);
  }
}
