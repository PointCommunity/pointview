import { z } from "zod";

import { providerCatalog, type ProviderModel } from "../types";

export interface CodexRpc {
  request(method: string, params?: unknown): Promise<unknown>;
}

const deviceLogin = z.object({
  type: z.literal("chatgptDeviceCode"),
  loginId: z.string().uuid(),
  verificationUrl: z.literal("https://auth.openai.com/codex/device"),
  userCode: z.string().regex(/^[A-Z0-9]{4,12}(?:-[A-Z0-9]{4,12})?$/),
}).strict();

const reasoningEffort = z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
const modelPage = z.object({
  data: z.array(z.object({
    id: z.string().trim().min(1).max(200),
    displayName: z.string().trim().min(1).max(200),
    hidden: z.boolean().optional().default(false),
    defaultReasoningEffort: reasoningEffort.nullable().optional().default(null),
    supportedReasoningEfforts: z.array(z.object({ reasoningEffort })).optional().default([]),
    inputModalities: z.array(z.enum(["text", "image"])).optional().default(["text"]),
  }).passthrough()).max(250),
  nextCursor: z.string().nullable().optional().default(null),
}).passthrough();

export async function startCodexDeviceLogin(rpc: CodexRpc) {
  const result = deviceLogin.parse(await rpc.request("account/login/start", { type: "chatgptDeviceCode" }));
  return { loginId: result.loginId, verificationUrl: result.verificationUrl, userCode: result.userCode };
}

export async function discoverCodexModels(rpc: CodexRpc): Promise<ProviderModel[]> {
  const models: ProviderModel[] = [];
  const cursors = new Set<string>();
  let pages = 0;
  let cursor: string | null = null;
  do {
    if (++pages > 20) throw new Error("Codex returned too many model pages");
    const page = modelPage.parse(await rpc.request("model/list", cursor ? { cursor } : {}));
    for (const model of page.data) {
      if (model.hidden) continue;
      models.push({
        id: model.id,
        displayName: model.displayName,
        reasoningEfforts: model.supportedReasoningEfforts.map((item) => item.reasoningEffort),
        defaultReasoningEffort: model.defaultReasoningEffort,
        inputModalities: model.inputModalities,
      });
    }
    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) throw new Error("Codex returned a repeated model cursor");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return providerCatalog.parse(models);
}
