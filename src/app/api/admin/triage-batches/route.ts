import { NextRequest } from "next/server";

import { authenticateSession, AuthenticationError } from "@/server/auth/request";
import { sessionCookie } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { sqlClient } from "@/server/db/client";
import { withCorrelationId } from "@/server/http/problem";
import { routeError } from "@/server/http/route-error";
import { operationsSnapshot } from "@/server/operations/metrics";

export async function GET(request: NextRequest) {
  const correlationId = withCorrelationId(request.headers);
  try {
    const config = serverConfig();
    const account = await authenticateSession(sqlClient(), request.cookies.get(sessionCookie.name)?.value, config.sessionSecret);
    if (account.role === "USER") throw new AuthenticationError("ACCESS_DENIED", "Only an Admin or Owner may view operations", 403);
    const [snapshot, batches, dispositions] = await Promise.all([
      operationsSnapshot(sqlClient()),
      sqlClient()<Array<{ id: string; state: string; startedAt: Date; finishedAt: Date | null; recordsAttempted: number; recordsCompleted: number; recordsNeedsAttention: number; stopReason: string | null }>>`
        select id, state, started_at as "startedAt", finished_at as "finishedAt", records_attempted as "recordsAttempted",
          records_completed as "recordsCompleted", records_needs_attention as "recordsNeedsAttention", stop_reason as "stopReason"
        from triage_batches order by started_at desc limit 50
      `,
      sqlClient()<Array<{ disposition: string; count: number }>>`select disposition, count(*)::int as count from triage_decisions where state = 'TERMINAL' group by disposition order by disposition`,
    ]);
    return Response.json({ snapshot, batches, dispositions }, { headers: { "cache-control": "private, no-store", "x-correlation-id": correlationId } });
  } catch (error) { return routeError(error, correlationId); }
}
