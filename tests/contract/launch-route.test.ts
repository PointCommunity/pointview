import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  account: { id: "018f4f6d-7c00-7000-8000-000000000081", role: "USER" as const, status: "ACTIVE" as const },
  consume: vi.fn(async () => "018f4f6d-7c00-7000-8000-000000000082"),
}));

vi.mock("@/server/config", () => ({ serverConfig: () => ({
  baseUrl: new URL("https://view.pointatx.org"),
  sessionSecret: "s".repeat(32),
  access: { teamDomain: new URL("https://point.cloudflareaccess.com"), audience: "access-aud" },
}) }));
vi.mock("@/server/db/client", () => ({ sqlClient: () => ({}) }));
vi.mock("@/server/auth/access", () => ({
  verifyRemoteAccessAssertion: vi.fn(async () => ({ subject: "subject", email: "user@example.test", displayName: "User" })),
}));
vi.mock("@/server/accounts/service", () => ({ findOrCreateAccount: vi.fn(async () => mocks.account) }));
vi.mock("@/server/launch/repository", () => ({
  findRegisteredLaunchSource: vi.fn(async () => ({ slug: "fixture" })),
  consumeVerifiedLaunch: mocks.consume,
}));
vi.mock("@/server/launch/verify", () => ({
  verifySourceLaunch: vi.fn(async (_token: string, dependencies: {
    consumeLaunch(sourceSlug: string, launch: Record<string, unknown>): Promise<string | null>;
  }) => {
    const launchSessionId = await dependencies.consumeLaunch("fixture", { nonce: "fixture" });
    if (!launchSessionId) throw new Error("replay");
    return { launchSessionId };
  }),
}));

import { POST } from "@/app/launch/route";

describe("POST /launch", () => {
  beforeEach(() => mocks.consume.mockClear());

  it("sets account, launch, and CSRF cookies then redirects to a token-free URL", async () => {
    const request = new NextRequest("https://view.pointatx.org/launch", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "cf-access-jwt-assertion": "access-token",
        origin: "https://fixture.test",
      },
      body: new URLSearchParams({ launch_token: "l".repeat(80) }),
    });
    const response = await POST(request);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://view.pointatx.org/feedback/new");
    expect(response.headers.get("location")).not.toContain("launch_token");
    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toContain("__Host-pointview_session=");
    expect(cookies).toContain("__Host-pointview_launch=");
    expect(cookies).toContain("__Host-pointview_csrf=");
    expect(cookies).toContain("Secure");
    expect(cookies).toContain("HttpOnly");
    expect(mocks.consume).toHaveBeenCalledOnce();
  });
});
