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

export const metadata = { title: "PointView settings" };

export default async function SettingsPage() {
  await connection();
  const config = serverConfig();
  const cookieStore = await cookies();
  const account = await authenticateSession(sqlClient(), cookieStore.get(sessionCookie.name)?.value, config.sessionSecret).catch(() => redirect("/"));
  if (account.role !== "OWNER") redirect("/feedback");
  const settings = await readSettings(sqlClient(), account);
  return <AppShell><section className="page-heading compact"><p className="eyebrow">Owner controls</p><h1>Triage policy.</h1><p className="lede">Every save creates a new immutable policy version. Secrets stay in the external secret store.</p></section><SettingsAdmin initial={settings} csrfToken={cookieStore.get(csrfCookie.name)?.value ?? ""} /></AppShell>;
}
