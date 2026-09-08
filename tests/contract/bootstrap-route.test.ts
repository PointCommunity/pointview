import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  account: {
    id: "018f4f6d-7c00-7000-8000-000000000091",
    role: "OWNER" as const,
    status: "ACTIVE" as const,
    version: 1,
    email: "owner@example.test",
    displayName: "Owner",
  },
  findOrCreate: vi.fn(),
}));

vi.mock("@/server/config", () => ({ serverConfig: () => ({
  baseUrl: new URL("https://view.pointatx.org"),
  sessionSecret: "s".repeat(32),
  access: { teamDomain: new URL("https://point.cloudflareaccess.com"), audience: "access-aud" },
}) }));
vi.mock("@/server/db/client", () => ({ sqlClient: () => ({}) }));
vi.mock("@/server/auth/access", () => ({
  verifyRemoteAccessAssertion: vi.fn(async () => ({ subject: "subject", email: "owner@example.test", displayName: "Owner" })),
}));
vi.mock("@/server/accounts/service", () => ({ findOrCreateAccount: mocks.findOrCreate }));

import { POST } from "@/app/bootstrap/route";

describe("POST /bootstrap", () => {
  beforeEach(() => mocks.findOrCreate.mockReset().mockResolvedValue(mocks.account));

  it("creates an Owner session from a valid Cloudflare Access identity", async () => {
    const response = await POST(new NextRequest("https://view.pointatx.org/bootstrap", {
      method: "POST",
      headers: { origin: "https://view.pointatx.org", "cf-access-jwt-assertion": "access-token" },
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://view.pointatx.org/admin/source-apps");
    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toContain("__Host-pointview_session=");
    expect(cookies).toContain("__Host-pointview_csrf=");
    expect(cookies).toContain("Secure");
    expect(cookies).toContain("HttpOnly");
    expect(mocks.findOrCreate).toHaveBeenCalledOnce();
  });

  it("rejects cross-origin bootstrap and non-Owner accounts without setting a session", async () => {
    const crossOrigin = await POST(new NextRequest("https://view.pointatx.org/bootstrap", {
      method: "POST",
      headers: { origin: "https://attacker.example", "cf-access-jwt-assertion": "access-token" },
    }));
    expect(crossOrigin.status).toBe(403);
    expect(mocks.findOrCreate).not.toHaveBeenCalled();

    mocks.findOrCreate.mockResolvedValueOnce({ ...mocks.account, role: "USER", status: "PENDING" });
    const pending = await POST(new NextRequest("https://view.pointatx.org/bootstrap", {
      method: "POST",
      headers: { origin: "https://view.pointatx.org", "cf-access-jwt-assertion": "access-token" },
    }));
    expect(pending.status).toBe(403);
    expect(pending.headers.getSetCookie()).toHaveLength(0);
  });
});
