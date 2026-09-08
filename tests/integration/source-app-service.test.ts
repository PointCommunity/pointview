import { exportJWK, generateKeyPair } from "jose";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDown, migrateUp } from "@/server/db/migrations";
import { newId } from "@/server/db/ids";
import { createSourceApp, updateSourceApp } from "@/server/source-apps/service";

const databaseUrl = process.env.DATABASE_TEST_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("source app registration service", () => {
  const sql = postgres(databaseUrl!, { max: 5 });
  const ownerId = newId();
  let publicJwk: Awaited<ReturnType<typeof exportJWK>>;

  beforeAll(async () => {
    await migrateDown(sql);
    await migrateUp(sql);
    const { publicKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    publicJwk = await exportJWK(publicKey);
    await sql`
      insert into accounts (id, access_subject_hash, email_normalized, display_name, role, status)
      values (${ownerId}, ${"c".repeat(64)}, 'owner@example.test', 'Owner', 'OWNER', 'ACTIVE')
    `;
  });

  afterAll(async () => {
    await migrateDown(sql);
    await sql.end();
  });

  const input = () => ({
    slug: "pointguide",
    displayName: "PointGuide",
    githubOwner: "PointCommunity",
    githubRepo: "pointguide",
    githubProjectNodeId: "PVT_pointguide",
    githubProjectNumber: 2,
    githubInstallationId: 42,
    allowedOrigins: ["https://guide.pointatx.org"],
    returnUrlPrefixes: ["https://guide.pointatx.org/"],
    governedLabels: ["type:bug", "type:feature", "type:maintenance", "type:security", "area:ui"],
    publicKeys: [{
      kid: "key-1",
      jwk: publicJwk,
      notBefore: "2026-01-01T00:00:00.000Z",
      notAfter: "2027-01-01T00:00:00.000Z",
    }],
  });

  it("creates disabled, rejects invalid activation, and versions an exact validated activation", async () => {
    const created = await createSourceApp(sql, {
      actor: { accountId: ownerId, role: "OWNER", status: "ACTIVE" },
      correlationId: newId(),
      input: input(),
    });
    expect(created).toMatchObject({ enabled: false, paused: false, version: 1, validation: { status: "UNKNOWN" } });

    await expect(updateSourceApp(sql, {
      actor: { accountId: ownerId, role: "OWNER", status: "ACTIVE" },
      sourceAppId: created.id,
      expectedVersion: 1,
      input: { ...input(), enabled: true, paused: false },
      correlationId: newId(),
      validateTarget: async () => ({ valid: false, errors: ["Project identity drifted"] }),
    })).rejects.toMatchObject({ code: "SOURCE_TARGET_INVALID" });

    const updated = await updateSourceApp(sql, {
      actor: { accountId: ownerId, role: "OWNER", status: "ACTIVE" },
      sourceAppId: created.id,
      expectedVersion: 1,
      input: { ...input(), enabled: true, paused: false },
      correlationId: newId(),
      validateTarget: async () => ({ valid: true, errors: [], digest: "d".repeat(64) }),
    });
    expect(updated).toMatchObject({ enabled: true, version: 2, validation: { status: "VALID" } });
  });

  it("rejects private key material", async () => {
    await expect(createSourceApp(sql, {
      actor: { accountId: ownerId, role: "OWNER", status: "ACTIVE" },
      correlationId: newId(),
      input: { ...input(), slug: "unsafe", publicKeys: [{ ...input().publicKeys[0], jwk: { ...publicJwk, d: "private" } }] },
    })).rejects.toMatchObject({ code: "SOURCE_INPUT_INVALID" });
  });
});
