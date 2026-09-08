import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { verifyAccessAssertion } from "@/server/auth/access";
import { validateAccountTransition } from "@/server/auth/policy";
import { createSession, readSession } from "@/server/auth/session";
import { createLaunchCookieValue, readLaunchCookieValue } from "@/server/launch/cookie";

describe("Cloudflare Access boundary", () => {
  it("verifies issuer, audience, expiry, and required identity claims", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "fixture";
    const issuer = "https://pointatx.cloudflareaccess.com";
    const token = await new SignJWT({ email: "USER@Example.test", name: "Fixture User" })
      .setProtectedHeader({ alg: "RS256", kid: "fixture" })
      .setIssuer(issuer)
      .setAudience("pointview-access")
      .setSubject("access-subject")
      .setIssuedAt()
      .setExpirationTime("2m")
      .sign(privateKey);

    const identity = await verifyAccessAssertion(token, {
      issuer,
      audience: "pointview-access",
      jwks: { keys: [publicJwk] },
    });
    expect(identity).toEqual({ subject: "access-subject", email: "user@example.test", displayName: "Fixture User" });
    await expect(
      verifyAccessAssertion(token, { issuer, audience: "wrong-audience", jwks: { keys: [publicJwk] } }),
    ).rejects.toThrow();
  });
});

describe("PointView sessions", () => {
  it("round-trips a short-lived encrypted server session", async () => {
    const secret = "a".repeat(32);
    const value = await createSession(
      { accountId: "018f4f6d-7c00-7000-8000-000000000001", role: "OWNER", status: "ACTIVE" },
      secret,
      { now: new Date("2026-09-07T12:00:00Z"), lifetimeSeconds: 300 },
    );
    await expect(readSession(value, secret, new Date("2026-09-07T12:04:59Z"))).resolves.toMatchObject({ role: "OWNER" });
    await expect(readSession(value, secret, new Date("2026-09-07T12:05:01Z"))).rejects.toThrow();
  });

  it("binds an encrypted launch cookie to its account for thirty minutes", async () => {
    const now = new Date("2026-09-07T12:00:00Z");
    const value = await createLaunchCookieValue({
      accountId: "018f4f6d-7c00-7000-8000-000000000061",
      launchSessionId: "018f4f6d-7c00-7000-8000-000000000062",
    }, "s".repeat(32), now);
    await expect(readLaunchCookieValue(value, "s".repeat(32), new Date("2026-09-07T12:29:59Z"))).resolves.toMatchObject({
      accountId: "018f4f6d-7c00-7000-8000-000000000061",
      launchSessionId: "018f4f6d-7c00-7000-8000-000000000062",
    });
    await expect(readLaunchCookieValue(value, "s".repeat(32), new Date("2026-09-07T12:30:01Z"))).rejects.toThrow();
  });
});

describe("account transitions", () => {
  it("reserves Owner membership changes for Owners and protects the final active Owner", () => {
    expect(() =>
      validateAccountTransition({ actorRole: "ADMIN", currentRole: "USER", currentStatus: "ACTIVE", nextRole: "OWNER", nextStatus: "ACTIVE", activeOwnerCount: 1 }),
    ).toThrow(/Owner/);
    expect(() =>
      validateAccountTransition({ actorRole: "OWNER", currentRole: "OWNER", currentStatus: "ACTIVE", nextRole: "ADMIN", nextStatus: "ACTIVE", activeOwnerCount: 1 }),
    ).toThrow(/final active Owner/);
    expect(
      validateAccountTransition({ actorRole: "OWNER", currentRole: "OWNER", currentStatus: "ACTIVE", nextRole: "ADMIN", nextStatus: "ACTIVE", activeOwnerCount: 2 }),
    ).toBeUndefined();
  });
});
