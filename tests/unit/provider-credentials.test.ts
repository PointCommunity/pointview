import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decryptCredential, encryptCredential } from "@/server/providers/credentials";

describe("provider credential envelopes", () => {
  const key = randomBytes(32);
  const context = { connectionId: "018f4f6d-7c00-7000-8000-000000000501", provider: "OLLAMA_CLOUD" as const, credentialVersion: 1 };

  it("round-trips a credential without placing plaintext in the envelope", () => {
    const plaintext = JSON.stringify({ apiKey: "ollama-secret-value" });
    const envelope = encryptCredential(plaintext, key, context);

    expect(envelope).toMatchObject({ algorithm: "A256GCM", keyVersion: 1 });
    expect(JSON.stringify(envelope)).not.toContain("ollama-secret-value");
    expect(decryptCredential(envelope, key, context)).toBe(plaintext);
  });

  it("rejects ciphertext moved to another provider or credential version", () => {
    const envelope = encryptCredential("sensitive", key, context);

    expect(() => decryptCredential(envelope, key, { ...context, provider: "OPENAI_CODEX" })).toThrow(/authenticate/i);
    expect(() => decryptCredential(envelope, key, { ...context, credentialVersion: 2 })).toThrow(/authenticate/i);
  });

  it("rejects tampering and invalid key lengths", () => {
    const envelope = encryptCredential("sensitive", key, context);
    const tampered = { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -2)}AA` };

    expect(() => decryptCredential(tampered, key, context)).toThrow(/authenticate/i);
    expect(() => encryptCredential("sensitive", randomBytes(16), context)).toThrow(/32 bytes/i);
  });
});
