import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { AppShell } from "@/components/app-shell";
import { WithdrawButton } from "@/components/feedback/withdraw-button";
import { csrfCookie } from "@/server/auth/csrf";
import { authenticateSession } from "@/server/auth/request";
import { sessionCookie } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { sqlClient } from "@/server/db/client";
import { FeedbackError, getFeedback } from "@/server/feedback/service";

type Props = { params: Promise<{ feedbackId: string }> };

export const metadata = { title: "Feedback detail" };

export default async function FeedbackDetailPage({ params }: Props) {
  await connection();
  const config = serverConfig();
  const cookieStore = await cookies();
  const account = await authenticateSession(sqlClient(), cookieStore.get(sessionCookie.name)?.value, config.sessionSecret)
    .catch(() => redirect("/"));
  const { feedbackId } = await params;
  const record = await getFeedback(sqlClient(), { ...account, feedbackId }).catch((error: unknown) => {
    if (error instanceof FeedbackError && error.status === 404) notFound();
    throw error;
  });
  const csrfToken = cookieStore.get(csrfCookie.name)?.value;
  return (
    <AppShell>
      <section className="page-heading compact">
        <p className="eyebrow">{record.sourceApp}</p>
        <h1>{record.screen || record.route}</h1>
        <div className="detail-meta">
          <span className={`state-badge state-${record.state.toLowerCase()}`}>{record.state.replaceAll("_", " ")}</span>
          <span>{record.submittedAt.toLocaleString()}</span>
          <span>{record.environment} · {record.appVersion}</span>
        </div>
      </section>
      <section className="detail-card">
        <h2>Feedback</h2>
        {record.feedback ? <p className="feedback-copy">{record.feedback}</p> : <p className="muted">Raw feedback has been deleted under the retention policy.</p>}
      </section>
      {record.attachments.length ? (
        <section className="detail-card">
          <h2>Screenshots</h2>
          <div className="attachment-grid">
            {record.attachments.map((attachment, index) => (
              <Link key={attachment.id} href={`/api/feedback/${record.id}/attachments/${attachment.id}`} target="_blank">
                Screenshot {index + 1}<small>{attachment.width} × {attachment.height} · {Math.ceil(attachment.sizeBytes / 1024)} KiB</small>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      {record.units.length ? (
        <section className="detail-card"><h2>Triage outcomes</h2><ul>{record.units.map((unit) => <li key={unit.id}>{unit.title} — {unit.disposition ?? unit.state}</li>)}</ul></section>
      ) : null}
      {record.state === "QUEUED" && csrfToken ? <WithdrawButton feedbackId={record.id} csrfToken={csrfToken} /> : null}
    </AppShell>
  );
}
