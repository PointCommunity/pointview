import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { AppShell } from "@/components/app-shell";
import { authenticateSession } from "@/server/auth/request";
import { sessionCookie } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { sqlClient } from "@/server/db/client";
import { listFeedback } from "@/server/feedback/service";

export const metadata = { title: "My feedback" };

export default async function FeedbackHistoryPage() {
  await connection();
  const config = serverConfig();
  const cookieStore = await cookies();
  const account = await authenticateSession(sqlClient(), cookieStore.get(sessionCookie.name)?.value, config.sessionSecret)
    .catch(() => redirect("/"));
  const { items } = await listFeedback(sqlClient(), { ...account, limit: 100 });
  return (
    <AppShell>
      <section className="page-heading compact">
        <p className="eyebrow">Feedback history</p>
        <h1>{account.role === "USER" ? "Your feedback." : "Submitted feedback."}</h1>
        <p className="lede">Triage organizes feedback into GitHub Issues. It never starts development work.</p>
      </section>
      {items.length ? (
        <ol className="record-list">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={`/feedback/${item.id}`}>
                <span><strong>{item.sourceApp}</strong><small>{item.screen || item.route}</small></span>
                <span><span className={`state-badge state-${item.state.toLowerCase()}`}>{item.state.replaceAll("_", " ")}</span><small>{item.submittedAt.toLocaleString()}</small></span>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <section className="empty-state small"><h2>No feedback yet</h2><p>Open PointView from a connected product to submit contextual feedback.</p></section>
      )}
    </AppShell>
  );
}
