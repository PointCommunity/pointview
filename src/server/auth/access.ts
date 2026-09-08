import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload } from "jose";
import { z } from "zod";

const claimsSchema = z.object({
  sub: z.string().min(1),
  email: z.email(),
  name: z.string().min(1).max(120).optional(),
});

type AccessVerification = {
  issuer: string;
  audience: string;
  jwks: JSONWebKeySet;
};

export type AccessIdentity = {
  subject: string;
  email: string;
  displayName: string;
};

function accessIdentity(payload: JWTPayload): AccessIdentity {
  const claims = claimsSchema.parse(payload);
  const email = claims.email.trim().toLowerCase();
  return { subject: claims.sub, email, displayName: claims.name?.trim() || email.split("@")[0] };
}

export async function verifyAccessAssertion(token: string, verification: AccessVerification): Promise<AccessIdentity> {
  const keySet = createLocalJWKSet(verification.jwks);
  const { payload } = await jwtVerify(token, keySet, {
    issuer: verification.issuer.replace(/\/$/, ""),
    audience: verification.audience,
    algorithms: ["RS256"],
    clockTolerance: 5,
  });
  return accessIdentity(payload);
}

export async function verifyRemoteAccessAssertion(
  token: string,
  input: { teamDomain: URL; audience: string },
): Promise<AccessIdentity> {
  const issuer = input.teamDomain.href.replace(/\/$/, "");
  const jwks = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", `${issuer}/`), {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
  });
  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience: input.audience,
    algorithms: ["RS256"],
    clockTolerance: 5,
  });
  return accessIdentity(payload);
}
