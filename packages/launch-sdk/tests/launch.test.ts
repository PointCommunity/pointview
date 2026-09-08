import { generateKeyPair, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";

import { launchClaimsSchema, renderLaunchForm, signLaunchContext } from "../src/index";

describe("PointView launch SDK", () => {
  it("signs canonical short-lived EdDSA context", async () => {
    const { privateKey, publicKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const now = new Date("2026-09-07T12:00:00Z");
    const token = await signLaunchContext({
      privateKey,
      keyId: "2026-09",
      sourceApp: "pointguide",
      environment: "canary",
      context: {
        location: "/training/session/123",
        screenName: "Training session",
        appVersion: "1.4.0",
        sourceRevision: "abc123",
        returnUrl: "https://guide.pointatx.org/training/session/123",
      },
      now,
    });

    const { payload, protectedHeader } = await jwtVerify(token, publicKey, { audience: "pointview", currentDate: now });
    expect(protectedHeader).toMatchObject({ alg: "EdDSA", kid: "2026-09", typ: "JWT" });
    const claims = launchClaimsSchema.parse(payload);
    expect(claims.iss).toBe("pointguide");
    expect(claims.source_app).toBe("pointguide");
    expect(claims.exp - claims.iat).toBe(300);
    expect(claims.context.screen_name).toBe("Training session");
  });

  it("renders a POST handoff containing only the signed token", () => {
    const html = renderLaunchForm({
      pointViewUrl: "https://view.pointatx.org",
      launchToken: "header.payload.signature",
      buttonLabel: "Send feedback",
    });
    expect(html).toContain('method="post"');
    expect(html).toContain('action="https://view.pointatx.org/launch"');
    expect(html).toContain('name="launch_token"');
    expect(html).not.toMatch(/private|github|repository/i);
  });

  it("rejects lifetimes longer than five minutes", async () => {
    const { privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    await expect(
      signLaunchContext({
        privateKey,
        keyId: "fixture",
        sourceApp: "fixture",
        environment: "development",
        context: { location: "/" },
        lifetimeSeconds: 301,
      }),
    ).rejects.toThrow(/300/);
  });
});
