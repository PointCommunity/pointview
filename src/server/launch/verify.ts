import { createHash } from "node:crypto";

import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose";
import { z } from "zod";

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);
const untrustedLocator = z.object({ source_app: slug });
const verifiedClaims = z
  .object({
    iss: slug,
    aud: z.union([z.literal("pointview"), z.array(z.literal("pointview"))]),
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
  .passthrough();

export type RegisteredLaunchSource = {
  slug: string;
  enabled: boolean;
  paused: boolean;
  allowedOrigins: string[];
  returnUrlPrefixes: string[];
  keys: Array<{
    kid: string;
    publicJwk: JWK;
    notBefore: Date;
    notAfter: Date;
    revokedAt: Date | null;
  }>;
};

type VerificationDependencies = {
  now?: Date;
  requestOrigin: string | null;
  findSource: (slug: string) => Promise<RegisteredLaunchSource | undefined>;
  consumeLaunch: (sourceSlug: string, launch: VerifiedLaunchDraft) => Promise<string | null>;
};

export type VerifiedLaunchDraft = {
  sourceApp: string;
  environment: "development" | "canary" | "production";
  location: string;
  screenName?: string;
  appVersion?: string;
  sourceRevision?: string;
  returnUrl?: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
  tokenFingerprint: string;
};

export type VerifiedLaunch = VerifiedLaunchDraft & { launchSessionId: string };

export async function verifySourceLaunch(token: string, dependencies: VerificationDependencies): Promise<VerifiedLaunch> {
  if (token.length < 40 || token.length > 8192) throw new Error("Launch assertion length is invalid");
  let locator: z.infer<typeof untrustedLocator>;
  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    locator = untrustedLocator.parse(decodeJwt(token));
    header = decodeProtectedHeader(token);
  } catch {
    throw new Error("Launch assertion cannot be decoded");
  }
  if (header.alg !== "EdDSA" || typeof header.kid !== "string") throw new Error("Launch signing header is invalid");
  const source = await dependencies.findSource(locator.source_app);
  if (!source || source.slug !== locator.source_app || !source.enabled || source.paused) {
    throw new Error("Launch source is unavailable");
  }
  if (!dependencies.requestOrigin || !source.allowedOrigins.includes(dependencies.requestOrigin)) {
    throw new Error("Launch request origin is not allowed");
  }
  const now = dependencies.now ?? new Date();
  const keyRecord = source.keys.find(
    (key) => key.kid === header.kid && !key.revokedAt && key.notBefore <= now && key.notAfter > now,
  );
  if (!keyRecord) throw new Error("Launch verification key is unavailable");
  const key = await importJWK(keyRecord.publicJwk, "EdDSA");
  const { payload } = await jwtVerify(token, key, {
    algorithms: ["EdDSA"],
    audience: "pointview",
    issuer: source.slug,
    currentDate: now,
    clockTolerance: 5,
    maxTokenAge: "5m",
  });
  const claims = verifiedClaims.parse(payload);
  if (claims.source_app !== source.slug || claims.exp - claims.iat > 300) throw new Error("Launch claims are inconsistent");
  const returnUrl = claims.context.return_url;
  if (returnUrl) {
    const parsed = new URL(returnUrl);
    if (parsed.protocol !== "https:" || !source.returnUrlPrefixes.some((prefix) => parsed.href.startsWith(prefix))) {
      throw new Error("Launch return URL is not allowed");
    }
  }
  const draft: VerifiedLaunchDraft = {
    sourceApp: source.slug,
    environment: claims.environment,
    location: claims.context.location,
    ...(claims.context.screen_name ? { screenName: claims.context.screen_name } : {}),
    ...(claims.context.app_version ? { appVersion: claims.context.app_version } : {}),
    ...(claims.context.source_revision ? { sourceRevision: claims.context.source_revision } : {}),
    ...(returnUrl ? { returnUrl } : {}),
    nonce: claims.jti,
    issuedAt: new Date(claims.iat * 1_000),
    expiresAt: new Date(claims.exp * 1_000),
    tokenFingerprint: createHash("sha256").update(token).digest("hex"),
  };
  const launchSessionId = await dependencies.consumeLaunch(source.slug, draft);
  if (!launchSessionId) throw new Error("Launch replay detected");
  return { ...draft, launchSessionId };
}
