import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { z } from "zod";

export const providerName = z.enum(["OLLAMA_CLOUD", "OPENAI_CODEX"]);
export type ProviderName = z.infer<typeof providerName>;

const envelopeSchema = z.object({
  algorithm: z.literal("A256GCM"),
  keyVersion: z.literal(1),
  iv: z.string().min(16).max(32),
  ciphertext: z.string().min(1).max(2_000_000),
  tag: z.string().min(16).max(32),
}).strict();

export type CredentialEnvelope = z.infer<typeof envelopeSchema>;
export type CredentialContext = { connectionId: string; provider: ProviderName; credentialVersion: number };

function requireKey(key: Uint8Array): Buffer {
  if (key.byteLength !== 32) throw new Error("Provider credential encryption key must be exactly 32 bytes");
  return Buffer.from(key);
}

function associatedData(context: CredentialContext): Buffer {
  return Buffer.from(`pointview-provider-credential\n${context.connectionId}\n${context.provider}\n${context.credentialVersion}`, "utf8");
}

export function encryptCredential(plaintext: string, key: Uint8Array, context: CredentialContext): CredentialEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", requireKey(key), iv);
  cipher.setAAD(associatedData(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    algorithm: "A256GCM",
    keyVersion: 1,
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptCredential(value: unknown, key: Uint8Array, context: CredentialContext): string {
  const envelope = envelopeSchema.parse(value);
  try {
    const decipher = createDecipheriv("aes-256-gcm", requireKey(key), Buffer.from(envelope.iv, "base64url"));
    decipher.setAAD(associatedData(context));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Provider credential could not be authenticated");
  }
}
