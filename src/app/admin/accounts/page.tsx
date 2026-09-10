import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { AppShell } from "@/components/app-shell";
import { AccountAdmin } from "@/components/admin/account-admin";
import { listAccounts } from "@/server/accounts/service";
import { csrfCookie } from "@/server/auth/csrf";
import { authenticateSession } from "@/server/auth/request";
import { sessionCookie } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { sqlClient } from "@/server/db/client";

export const metadata = { title: "Account administration" };

export default async function AccountsPage() {
  await connection();
  const config = serverConfig();
  const cookieStore = await cookies();
  const account = await authenticateSession(sqlClient(), cookieStore.get(sessionCookie.name)?.value, config.sessionSecret).catch(() => redirect("/"));
  if (account.role === "USER") redirect("/feedback");
  const accounts = await listAccounts(sqlClient(), account);
  return <AppShell administration={{ current: "accounts", role: account.role }}><section className="page-heading compact"><p className="eyebrow">Administration</p><h1>Account access.</h1><p className="lede">Approve, suspend, or assign roles. Only Owners can change Owner membership.</p></section><AccountAdmin initialAccounts={accounts} csrfToken={cookieStore.get(csrfCookie.name)?.value ?? ""} actorRole={account.role} /></AppShell>;
}
