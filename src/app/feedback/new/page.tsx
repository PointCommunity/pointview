import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { AppShell } from "@/components/app-shell";
import { FeedbackForm } from "@/components/feedback/feedback-form";
import { csrfCookie } from "@/server/auth/csrf";
import { authenticateSession } from "@/server/auth/request";
import { sessionCookie } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { sqlClient } from "@/server/db/client";
import { FeedbackError, getLaunchContext } from "@/server/feedback/service";
import { launchCookie, readLaunchCookieValue } from "@/server/launch/cookie";

export const metadata = { title: "New feedback" };

export default async function NewFeedbackPage() {
  await connection();
  const config = serverConfig();
  const cookieStore = await cookies();
  const account = await authenticateSession(sqlClient(), cookieStore.get(sessionCookie.name)?.value, config.sessionSecret)
    .catch(() => redirect("/"));
  const encodedLaunch = cookieStore.get(launchCookie.name)?.value;
  const csrfToken = cookieStore.get(csrfCookie.name)?.value;
  if (!encodedLaunch || !csrfToken) return <UnavailableLaunch />;
  const launch = await readLaunchCookieValue(encodedLaunch, config.sessionSecret).catch(() => null);
  if (!launch || launch.accountId !== account.accountId) return <UnavailableLaunch />;
  const context = await getLaunchContext(sqlClient(), { accountId: account.accountId, launchSessionId: launch.launchSessionId })
    .catch((error: unknown) => {
      if (error instanceof FeedbackError) return null;
      throw error;
    });
  if (!context) return <UnavailableLaunch />;
  return (
    <AppShell>
      <section className="page-heading">
        <p className="eyebrow">Private feedback</p>
        <h1>Tell us what you found.</h1>
        <p className="lede">The product and screen are already verified. Add only the feedback and screenshots that help explain it.</p>
      </section>
      <FeedbackForm context={context} csrfToken={csrfToken} />
    </AppShell>
  );
}

function UnavailableLaunch() {
  return (
    <AppShell>
      <section className="empty-state">
        <p className="eyebrow">Launch unavailable</p>
        <h1>Open feedback from the product again.</h1>
        <p className="lede">For your protection, verified product links are short-lived and can be used only once.</p>
      </section>
    </AppShell>
  );
}
