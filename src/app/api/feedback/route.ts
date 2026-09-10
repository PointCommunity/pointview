import { NextRequest } from "next/server";

import { csrfCookie, verifyCsrfRequest } from "@/server/auth/csrf";
import { authenticateSession } from "@/server/auth/request";
import { sessionCookie } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { sqlClient } from "@/server/db/client";
import { createFeedback, FeedbackError, listFeedback } from "@/server/feedback/service";
import { NoOpAttachmentScanner } from "@/server/feedback/scanner";
import { presentFeedback, presentFeedbackSummary } from "@/server/feedback/presenter";
import { feedbackRateLimiter } from "@/server/http/limits";
import { problem, withCorrelationId } from "@/server/http/problem";
import { rateLimitHeaders } from "@/server/http/rate-limit";
import { routeError } from "@/server/http/route-error";
import { launchCookie, readLaunchCookieValue } from "@/server/launch/cookie";
import { FileAttachmentStore } from "@/server/storage/file-store";

function limited(correlationId: string, rate: ReturnType<typeof feedbackRateLimiter.consume>) {
  const response = problem({ status: 429, title: "Too many feedback requests", code: "RATE_LIMITED" }, correlationId);
  for (const [name, value] of Object.entries(rateLimitHeaders(rate))) response.headers.set(name, String(value));
  return response;
}

export async function GET(request: NextRequest) {
  const correlationId = withCorrelationId(request.headers);
  try {
    const config = serverConfig();
    const account = await authenticateSession(sqlClient(), request.cookies.get(sessionCookie.name)?.value, config.sessionSecret);
    const rate = feedbackRateLimiter.consume(`read:${account.accountId}`);
    if (!rate.allowed) return limited(correlationId, rate);
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 25);
    const result = await listFeedback(sqlClient(), {
      ...account,
      limit: Number.isFinite(limit) ? limit : 25,
      cursor: new URL(request.url).searchParams.get("cursor"),
    });
    return Response.json({ items: result.items.map(presentFeedbackSummary), next_cursor: result.nextCursor }, {
      headers: { "cache-control": "private, no-store", "x-correlation-id": correlationId, ...rateLimitHeaders(rate) },
    });
  } catch (error) {
    return routeError(error, correlationId);
  }
}

export async function POST(request: NextRequest) {
  const correlationId = withCorrelationId(request.headers);
  try {
    const config = serverConfig();
    const sql = sqlClient();
    const account = await authenticateSession(sql, request.cookies.get(sessionCookie.name)?.value, config.sessionSecret);
    verifyCsrfRequest(request.headers, config.baseUrl.origin, request.cookies.get(csrfCookie.name)?.value);
    const rate = feedbackRateLimiter.consume(`write:${account.accountId}`);
    if (!rate.allowed) return limited(correlationId, rate);
    const encodedLaunch = request.cookies.get(launchCookie.name)?.value;
    if (!encodedLaunch) throw new FeedbackError("LAUNCH_UNAVAILABLE", "A verified product launch is required", 409);
    const launch = await readLaunchCookieValue(encodedLaunch, config.sessionSecret).catch(() => {
      throw new FeedbackError("LAUNCH_UNAVAILABLE", "The verified product launch expired", 409);
    });
    if (launch.accountId !== account.accountId) throw new FeedbackError("LAUNCH_UNAVAILABLE", "The verified product launch is invalid", 409);
    const form = await request.formData().catch(() => {
      throw new FeedbackError("FORM_INVALID", "The submitted form could not be read", 400);
    });
    const feedback = form.get("feedback");
    if (typeof feedback !== "string") throw new FeedbackError("FEEDBACK_INVALID", "Feedback text is required", 400);
    const screenshots = form.getAll("screenshots").filter((value): value is File => value instanceof File && value.size > 0);
    if (screenshots.some((file) => file.size > 10 * 1024 * 1024)) {
      throw new FeedbackError("ATTACHMENT_TOO_LARGE", "Each screenshot must be 10 MiB or smaller", 413);
    }
    const created = await createFeedback(sql, {
      accountId: account.accountId,
      launchSessionId: launch.launchSessionId,
      feedback,
      privacyAcknowledged: form.get("privacy_acknowledged") === "true",
      screenshots: await Promise.all(screenshots.map(async (file) => ({
        bytes: Buffer.from(await file.arrayBuffer()),
        name: file.name,
        mimeType: file.type,
      }))),
      policyVersion: "privacy-v1",
      store: new FileAttachmentStore(config.attachmentRoot),
      scanner: new NoOpAttachmentScanner(),
      correlationId,
    });
    return Response.json(presentFeedback(created), {
      status: 201,
      headers: {
        location: `/feedback/${created.id}`,
        "cache-control": "private, no-store",
        "x-correlation-id": correlationId,
        ...rateLimitHeaders(rate),
      },
    });
  } catch (error) {
    return routeError(error, correlationId);
  }
}
