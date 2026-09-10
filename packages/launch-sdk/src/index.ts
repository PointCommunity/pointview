import { randomBytes } from "node:crypto";

import { SignJWT } from "jose";
import { z } from "zod";

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);

export const launchClaimsSchema = z
  .object({
    iss: slug,
    aud: z.literal("pointview"),
    iat: z.number().int().positive(),
    exp: z.number().int().positive(),
    jti: z.string().min(20).max(200),
    source_app: slug,
    environment: z.enum(["development", "canary", "production"]),
    context: z
      .object({
        location: z.string().min(1).max(500),
        screen_name: z.string().min(1).max(120).optional(),
        app_version: z.string().min(1).max(100).optional(),
        source_revision: z.string().regex(/^[A-Za-z0-9._/-]{1,100}$/).optional(),
        return_url: z.url().max(1000).optional(),
      })
      .strict(),
  })
  .strict()
  .refine((claims) => claims.iss === claims.source_app, "issuer must equal source_app")
  .refine((claims) => claims.exp > claims.iat && claims.exp - claims.iat <= 300, "lifetime must not exceed 300 seconds");

export type LaunchContext = {
  location: string;
  screenName?: string;
  appVersion?: string;
  sourceRevision?: string;
  returnUrl?: string;
};

type SignLaunchInput = {
  privateKey: CryptoKey;
  keyId: string;
  sourceApp: string;
  environment: "development" | "canary" | "production";
  context: LaunchContext;
  now?: Date;
  lifetimeSeconds?: number;
  nonce?: string;
};

export async function signLaunchContext(input: SignLaunchInput): Promise<string> {
  const now = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  const lifetime = input.lifetimeSeconds ?? 300;
  if (!Number.isInteger(lifetime) || lifetime < 1 || lifetime > 300) {
    throw new Error("Launch lifetime must be between 1 and 300 seconds");
  }
  const claims = launchClaimsSchema.parse({
    iss: input.sourceApp,
    aud: "pointview",
    iat: now,
    exp: now + lifetime,
    jti: input.nonce ?? randomBytes(24).toString("base64url"),
    source_app: input.sourceApp,
    environment: input.environment,
    context: {
      location: input.context.location,
      ...(input.context.screenName ? { screen_name: input.context.screenName } : {}),
      ...(input.context.appVersion ? { app_version: input.context.appVersion } : {}),
      ...(input.context.sourceRevision ? { source_revision: input.context.sourceRevision } : {}),
      ...(input.context.returnUrl ? { return_url: input.context.returnUrl } : {}),
    },
  });
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "EdDSA", kid: input.keyId, typ: "JWT" })
    .sign(input.privateKey);
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function renderLaunchForm(input: { pointViewUrl: string; launchToken: string; buttonLabel?: string }): string {
  const action = new URL("/launch", input.pointViewUrl);
  if (action.protocol !== "https:") throw new Error("PointView launch URL must use HTTPS");
  return `<form method="post" action="${escapeAttribute(action.href)}"><input type="hidden" name="launch_token" value="${escapeAttribute(input.launchToken)}"><button type="submit">${escapeAttribute(input.buttonLabel ?? "Send feedback")}</button></form>`;
}
