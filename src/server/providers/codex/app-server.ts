import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

import type { CodexRpc } from "./protocol";

type Pending = { resolve(value: unknown): void; reject(error: Error): void; timeout: ReturnType<typeof setTimeout> };
type NotificationHandler = (method: string, params: unknown) => void;

function codexEntrypoint(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve(/* webpackIgnore: true */ "@openai/codex/package.json")), "bin", "codex.js");
}

export class CodexAppServer implements CodexRpc {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly notifications = new Set<NotificationHandler>();
  private closed = false;

  private constructor(readonly child: ChildProcessWithoutNullStreams) {
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.receive(line));
    child.stderr.resume();
    child.once("exit", () => this.failAll(new Error("Codex sign-in service stopped")));
    child.once("error", () => this.failAll(new Error("Codex sign-in service could not start")));
  }

  static async start(codexHome: string): Promise<CodexAppServer> {
    const child = spawn(process.execPath, [codexEntrypoint(), "app-server", "--listen", "stdio://"], {
      env: { CODEX_HOME: codexHome, HOME: dirname(codexHome), PATH: "/usr/local/bin:/usr/bin:/bin", TMPDIR: dirname(codexHome), NODE_ENV: "production" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const server = new CodexAppServer(child);
    await server.request("initialize", {
      clientInfo: { name: "pointview", title: "PointView", version: "0.1.0" },
      capabilities: { experimentalApi: false },
    });
    server.notify("initialized");
    return server;
  }

  onNotification(handler: NotificationHandler): () => void {
    this.notifications.add(handler);
    return () => this.notifications.delete(handler);
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("Codex sign-in service is closed"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Codex sign-in service timed out"));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timeout });
      this.write({ id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write({ method, ...(params === undefined ? {} : { params }) });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.child.kill("SIGTERM");
    this.failAll(new Error("Codex sign-in service closed"));
  }

  private write(message: unknown): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line: string): void {
    let message: { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message?: string } };
    try { message = JSON.parse(line) as typeof message; } catch { return; }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) {
        if (message.method) this.write({ id: message.id, error: { code: -32601, message: "Unsupported server request" } });
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(message.error.message || "Codex request failed"));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) for (const handler of this.notifications) handler(message.method, message.params);
  }

  private failAll(error: Error): void {
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
