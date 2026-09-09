import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type postgres from "postgres";

import type { RequestAccount } from "@/server/feedback/service";
import { ProviderConnectionError, saveConnectedProvider } from "@/server/providers/repository";

import { CodexAppServer } from "./app-server";
import { discoverCodexModels, startCodexDeviceLogin } from "./protocol";

type AuthorizationSession = {
  id: string;
  accountId: string;
  loginId: string;
  verificationUrl: string;
  userCode: string;
  expectedVersion: number;
  expiresAt: number;
  root: string;
  codexHome: string;
  server: CodexAppServer;
  state: "WAITING" | "COMPLETED" | "FAILED";
};

const sessionKey = Symbol.for("pointview.codexAuthorizationSessions");
const globalSessions = globalThis as typeof globalThis & { [sessionKey]?: Map<string, AuthorizationSession> };
const sessions = globalSessions[sessionKey] ??= new Map<string, AuthorizationSession>();

function requireOwner(actor: RequestAccount): void {
  if (actor.status !== "ACTIVE" || actor.role !== "OWNER") throw new ProviderConnectionError("ACCESS_DENIED", "Only an Owner may connect Codex", 403);
}

async function dispose(session: AuthorizationSession): Promise<void> {
  sessions.delete(session.id);
  session.server.close();
  await rm(session.root, { recursive: true, force: true });
}

export async function discoverCodexCatalog(credential: string) {
  const root = await mkdtemp(join(tmpdir(), "pointview-codex-catalog-"));
  const codexHome = join(root, "codex");
  await mkdir(codexHome, { mode: 0o700 });
  await writeFile(join(codexHome, "auth.json"), credential, { encoding: "utf8", mode: 0o600, flag: "wx" });
  let server: CodexAppServer | null = null;
  try {
    server = await CodexAppServer.start(codexHome);
    const models = await discoverCodexModels(server);
    const refreshedCredential = await readFile(join(codexHome, "auth.json"), "utf8");
    return { models, refreshedCredential };
  } finally {
    server?.close();
    await rm(root, { recursive: true, force: true });
  }
}

export async function startCodexAuthorization(actor: RequestAccount, expectedVersion: number) {
  requireOwner(actor);
  for (const session of sessions.values()) {
    if (session.accountId === actor.accountId) await dispose(session);
  }
  const root = await mkdtemp(join(tmpdir(), "pointview-codex-auth-"));
  const codexHome = join(root, "codex");
  await mkdir(codexHome, { mode: 0o700 });
  try {
    const server = await CodexAppServer.start(codexHome);
    const login = await startCodexDeviceLogin(server);
    const session: AuthorizationSession = {
      id: randomUUID(), accountId: actor.accountId, loginId: login.loginId,
      verificationUrl: login.verificationUrl, userCode: login.userCode,
      expectedVersion, expiresAt: Date.now() + 10 * 60_000, root, codexHome, server, state: "WAITING",
    };
    server.onNotification((method, params) => {
      if (method !== "account/login/completed" || typeof params !== "object" || params === null) return;
      const event = params as { loginId?: string; success?: boolean };
      if (event.loginId !== session.loginId) return;
      session.state = event.success === false ? "FAILED" : "COMPLETED";
    });
    sessions.set(session.id, session);
    const expiry = setTimeout(() => void dispose(session), 10 * 60_000);
    expiry.unref();
    return { sessionId: session.id, verificationUrl: session.verificationUrl, userCode: session.userCode, expiresAt: new Date(session.expiresAt).toISOString() };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function finishCodexAuthorization(sql: postgres.Sql, options: {
  actor: RequestAccount;
  sessionId: string;
  encryptionKey: Uint8Array;
  correlationId: string;
}) {
  requireOwner(options.actor);
  const session = sessions.get(options.sessionId);
  if (!session || session.accountId !== options.actor.accountId || session.expiresAt <= Date.now()) {
    if (session) await dispose(session);
    return { state: "EXPIRED" as const };
  }
  if (session.state === "WAITING") return { state: "WAITING" as const };
  if (session.state === "FAILED") {
    await dispose(session);
    return { state: "FAILED" as const };
  }
  try {
    const credential = await readFile(join(session.codexHome, "auth.json"), "utf8");
    const models = await discoverCodexModels(session.server);
    const connection = await saveConnectedProvider(sql, {
      actor: options.actor, provider: "OPENAI_CODEX", credential, encryptionKey: options.encryptionKey,
      planType: "ChatGPT", models, correlationId: options.correlationId, expectedVersion: session.expectedVersion,
    });
    return { state: "CONNECTED" as const, connection };
  } finally {
    await dispose(session);
  }
}
