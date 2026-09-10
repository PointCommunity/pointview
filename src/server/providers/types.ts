import { z } from "zod";

import { providerName } from "./credentials";

export const providerModel = z.object({
  id: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(200),
  reasoningEfforts: z.array(z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"])).max(8),
  defaultReasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]).nullable(),
  inputModalities: z.array(z.enum(["text", "image"])).min(1).max(2),
}).strict().superRefine((model, context) => {
  if (!model.inputModalities.includes("text") || new Set(model.inputModalities).size !== model.inputModalities.length) {
    context.addIssue({ code: "custom", path: ["inputModalities"], message: "Model modalities must include text without duplicates" });
  }
  if (new Set(model.reasoningEfforts).size !== model.reasoningEfforts.length) {
    context.addIssue({ code: "custom", path: ["reasoningEfforts"], message: "Reasoning choices must be unique" });
  }
  if (model.defaultReasoningEffort !== null && !model.reasoningEfforts.includes(model.defaultReasoningEffort)) {
    context.addIssue({ code: "custom", path: ["defaultReasoningEffort"], message: "Default reasoning must be an available choice" });
  }
});

export const providerCatalog = z.array(providerModel).max(250).transform((models) => {
  const byId = new Map(models.map((model) => [model.id, model]));
  return [...byId.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
});

export type ProviderModel = z.infer<typeof providerModel>;
export type ProviderConnectionSummary = {
  provider: z.infer<typeof providerName>;
  status: "DISCONNECTED" | "AUTHORIZING" | "CONNECTED" | "ERROR";
  credentialConfigured: boolean;
  planType: string | null;
  models: ProviderModel[];
  lastVerifiedAt: string | null;
  failureCode: string | null;
  version: number;
};
