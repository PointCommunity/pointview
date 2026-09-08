import { exportJWK, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";

import { signLaunchContext } from "../../packages/launch-sdk/src/index";
import { verifySourceLaunch } from "@/server/launch/verify";

describe("source launch verification", () => {
  it("accepts a valid assertion once and binds verified context", async () => {
    const { privateKey, publicKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const publicJwk = await exportJWK(publicKey);
    const now = new Date("2026-09-07T12:00:00Z");
    const token = await signLaunchContext({
      privateKey,
      keyId: "key-1",
      sourceApp: "pointguide",
      environment: "production",
      context: { location: "/m32", screenName: "M32", returnUrl: "https://guide.pointatx.org/m32" },
      nonce: "unique-nonce-at-least-twenty",
      now,
    });
    const used = new Set<string>();
    const source = {
      slug: "pointguide",
      enabled: true,
      paused: false,
      allowedOrigins: ["https://guide.pointatx.org"],
      returnUrlPrefixes: ["https://guide.pointatx.org/"],
      keys: [{ kid: "key-1", publicJwk, notBefore: new Date("2026-01-01"), notAfter: new Date("2027-01-01"), revokedAt: null }],
    };

    const verified = await verifySourceLaunch(token, {
      now,
      requestOrigin: "https://guide.pointatx.org",
      findSource: async () => source,
      consumeLaunch: async (_source, launch) => {
        if (used.has(launch.nonce)) return null;
        used.add(launch.nonce);
        return "018f4f6d-7c00-7000-8000-000000000051";
      },
    });
    expect(verified).toMatchObject({ sourceApp: "pointguide", location: "/m32", screenName: "M32" });
    await expect(
      verifySourceLaunch(token, {
        now,
        requestOrigin: "https://guide.pointatx.org",
        findSource: async () => source,
        consumeLaunch: async (_source, launch) => used.has(launch.nonce) ? null : "session",
      }),
    ).rejects.toThrow(/replay/i);
  });

  it("rejects an unregistered origin before consuming the nonce", async () => {
    const { privateKey, publicKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const token = await signLaunchContext({
      privateKey,
      keyId: "key-1",
      sourceApp: "fixture",
      environment: "canary",
      context: { location: "/" },
    });
    let consumed = false;
    await expect(
      verifySourceLaunch(token, {
        requestOrigin: "https://attacker.test",
        findSource: async () => ({
          slug: "fixture",
          enabled: true,
          paused: false,
          allowedOrigins: ["https://fixture.test"],
          returnUrlPrefixes: ["https://fixture.test/"],
          keys: [{ kid: "key-1", publicJwk: await exportJWK(publicKey), notBefore: new Date(0), notAfter: new Date("2999-01-01"), revokedAt: null }],
        }),
        consumeLaunch: async () => {
          consumed = true;
          return "session";
        },
      }),
    ).rejects.toThrow(/origin/i);
    expect(consumed).toBe(false);
  });
});
