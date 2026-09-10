import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { SourceAdmin } from "@/components/admin/source-admin";
import { AppShell } from "@/components/app-shell";
import { csrfCookie } from "@/server/auth/csrf";
import { authenticateSession } from "@/server/auth/request";
import { sessionCookie } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { sqlClient } from "@/server/db/client";
import { presentSourceApp } from "@/server/source-apps/presenter";
import { listSourceAppHistory, listSourceApps } from "@/server/source-apps/service";

export const metadata = { title: "Source app administration" };

export default async function SourceAppsPage() {
  await connection();
  const config = serverConfig(); const cookieStore = await cookies();
  const account = await authenticateSession(sqlClient(), cookieStore.get(sessionCookie.name)?.value, config.sessionSecret).catch(() => redirect("/"));
  if (account.role !== "OWNER") redirect("/feedback");
  const [sources, history] = await Promise.all([listSourceApps(sqlClient(), account), listSourceAppHistory(sqlClient(), account)]);
  return <AppShell administration={{ current: "sources", role: account.role }}><section className="page-heading compact"><p className="eyebrow">Owner controls</p><h1>Source integrations.</h1><p className="lede">Each source is pinned to one repository, one private Project, exact origins, and rotating public launch keys.</p></section><SourceAdmin initialSources={sources.map(presentSourceApp)} history={history.map((event) => ({ ...event, eventAt: event.eventAt.toISOString() }))} csrfToken={cookieStore.get(csrfCookie.name)?.value ?? ""} /></AppShell>;
}
