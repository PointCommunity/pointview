import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
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

export async function verifyAccessAssertion(token: string, verification: AccessVerification): Promise<AccessIdentity> {
  const keySet = createLocalJWKSet(verification.jwks);
  const { payload } = await jwtVerify(token, keySet, {
    issuer: verification.issuer.replace(/\/$/, ""),
    audience: verification.audience,
    algorithms: ["RS256"],
    clockTolerance: 5,
  });
  const claims = claimsSchema.parse(payload);
  const email = claims.email.trim().toLowerCase();
  return { subject: claims.sub, email, displayName: claims.name?.trim() || email.split("@")[0] };
}

