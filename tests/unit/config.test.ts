import { describe, expect, it } from "vitest";

import { parseServerConfig } from "@/server/config/server";

const valid = {
  NODE_ENV: "test",
  POINTVIEW_BASE_URL: "https://view.pointatx.org",
  POINTVIEW_AUDIENCE: "pointview",
  DATABASE_URL: "postgres://pointview:secret@db:5432/pointview",
  SESSION_SECRET: "a".repeat(32),
  CF_ACCESS_TEAM_DOMAIN: "https://pointatx.cloudflareaccess.com",
  CF_ACCESS_AUD: "access-audience",
  ATTACHMENT_ROOT: "/var/lib/pointview/attachments",
  GITHUB_APP_ID: "123",
  GITHUB_APP_INSTALLATION_ID: "456",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
  POINTVIEW_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  POINTVIEW_SOURCE_REVISION: "abc123",
};

describe("parseServerConfig", () => {
  it("parses a complete server-only configuration", () => {
    const parsed = parseServerConfig(valid);
    expect(parsed.baseUrl.href).toBe("https://view.pointatx.org/");
    expect(parsed.github.appId).toBe(123);
    expect(parsed.credentialEncryptionKey).toHaveLength(32);
    expect(parsed.triageWritesEnabled).toBe(false);
  });

  it("rejects insecure origins and short session secrets", () => {
    expect(() => parseServerConfig({ ...valid, POINTVIEW_BASE_URL: "http://view.pointatx.org" })).toThrow();
    expect(() => parseServerConfig({ ...valid, SESSION_SECRET: "short" })).toThrow();
  });

  it("does not include secret values in validation errors", () => {
    const secret = "do-not-leak-this-secret";
    expect(() => parseServerConfig({ ...valid, POINTVIEW_CREDENTIAL_ENCRYPTION_KEY: secret, SESSION_SECRET: secret })).toThrowError(
      expect.not.objectContaining({ message: expect.stringContaining(secret) }),
    );
  });

  it("requires exactly one 256-bit provider credential encryption key", () => {
    expect(() => parseServerConfig({ ...valid, POINTVIEW_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(31).toString("base64") })).toThrow(/POINTVIEW_CREDENTIAL_ENCRYPTION_KEY/);
  });

  it("requires an explicit boolean string for the triage mutation boundary", () => {
    expect(parseServerConfig({ ...valid, POINTVIEW_TRIAGE_WRITES_ENABLED: "true" }).triageWritesEnabled).toBe(true);
    expect(() => parseServerConfig({ ...valid, POINTVIEW_TRIAGE_WRITES_ENABLED: "yes" })).toThrow();
  });
});
