import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { AppShell } from "@/components/app-shell";
import { authenticateSession } from "@/server/auth/request";
import { sessionCookie } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { sqlClient } from "@/server/db/client";
import { operationsSnapshot } from "@/server/operations/metrics";

export const metadata = { title: "Triage operations" };

export default async function OperationsPage() {
  await connection();
  const config = serverConfig();
  const cookieStore = await cookies();
  const account = await authenticateSession(sqlClient(), cookieStore.get(sessionCookie.name)?.value, config.sessionSecret).catch(() => redirect("/"));
  if (account.role === "USER") redirect("/feedback");
  const snapshot = await operationsSnapshot(sqlClient());
  const batches = await sqlClient()<Array<{ id: string; state: string; startedAt: Date; recordsAttempted: number; stopReason: string | null }>>`
    select id, state, started_at as "startedAt", records_attempted as "recordsAttempted", stop_reason as "stopReason"
    from triage_batches order by started_at desc limit 25
  `;
  return <AppShell administration={{ current: "operations", role: account.role }}><section className="page-heading compact"><p className="eyebrow">Operations</p><h1>Daily triage health.</h1><p className="lede">The runner works oldest-first, one record at a time, and never initiates development.</p></section>
    <section className="metric-grid" aria-label="Triage metrics"><article><strong>{snapshot.queueDepth}</strong><span>Queued</span></article><article><strong>{snapshot.needsAttention}</strong><span>Needs attention</span></article><article><strong>{snapshot.oldestQueuedSeconds}s</strong><span>Oldest queued</span></article><article><strong>{snapshot.retries}</strong><span>Retries</span></article><article><strong>{snapshot.githubRateLimits}</strong><span>GitHub limits</span></article><article><strong>{snapshot.estimatedCostMicros === null ? "Not configured" : `${snapshot.estimatedCostMicros} µUSD`}</strong><span>Estimated model cost</span></article><article><strong>{snapshot.lastSuccessfulCycle?.toLocaleString() ?? "Never"}</strong><span>Last success</span></article></section>
    <section className="detail-card"><h2>Recent batches</h2>{batches.length ? <ol className="compact-list">{batches.map((batch) => <li key={batch.id}><strong>{batch.state}</strong><span>{batch.startedAt.toLocaleString()} · {batch.recordsAttempted} attempted{batch.stopReason ? ` · ${batch.stopReason}` : ""}</span></li>)}</ol> : <p className="muted">No triage batch has run yet.</p>}</section>
  </AppShell>;
}
