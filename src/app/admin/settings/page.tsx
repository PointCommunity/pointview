import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { SettingsAdmin } from "@/components/admin/settings-admin";
import { AppShell } from "@/components/app-shell";
import { csrfCookie } from "@/server/auth/csrf";
import { authenticateSession } from "@/server/auth/request";
import { sessionCookie } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { readSettings } from "@/server/config/settings";
import { sqlClient } from "@/server/db/client";
import { listProviderConnections } from "@/server/providers/repository";

export const metadata = { title: "PointView settings" };

export default async function SettingsPage() {
  await connection();
  const config = serverConfig();
  const cookieStore = await cookies();
  const account = await authenticateSession(sqlClient(), cookieStore.get(sessionCookie.name)?.value, config.sessionSecret).catch(() => redirect("/"));
  if (account.role !== "OWNER") redirect("/feedback");
  const settings = await readSettings(sqlClient(), account);
  const connections = await listProviderConnections(sqlClient(), account);
  return <AppShell administration={{ current: "providers", role: account.role }}><section className="page-heading compact"><p className="eyebrow">Owner controls</p><h1>Set up automatic triage.</h1><p className="lede">Connect an AI service, choose a model, and PointView handles the technical policy safely in the background.</p></section><SettingsAdmin initial={settings} initialConnections={connections} csrfToken={cookieStore.get(csrfCookie.name)?.value ?? ""} /></AppShell>;
}
