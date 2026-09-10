import { AccountError } from "@/server/accounts/service";
import { AuthenticationError } from "@/server/auth/request";
import { CsrfError } from "@/server/auth/csrf";
import { SettingsError } from "@/server/config/settings";
import { FeedbackError } from "@/server/feedback/service";
import { SourceAppError } from "@/server/source-apps/service";
import { ProviderConnectionError } from "@/server/providers/repository";
import { OllamaProviderError } from "@/server/providers/ollama";
import { RequeueError } from "@/server/triage/requeue";
import { ZodError } from "zod";

import { problem } from "./problem";

export function routeError(error: unknown, correlationId: string): Response {
  if (error instanceof ZodError) return problem({ status: 400, title: "The submitted information is invalid", code: "INPUT_INVALID" }, correlationId);
  if (error instanceof AuthenticationError || error instanceof FeedbackError || error instanceof CsrfError || error instanceof SourceAppError || error instanceof AccountError || error instanceof SettingsError || error instanceof RequeueError || error instanceof ProviderConnectionError || error instanceof OllamaProviderError) {
    return problem({ status: error.status, title: error.message, code: error.code }, correlationId);
  }
  return problem({ status: 500, title: "The request could not be completed", code: "INTERNAL_ERROR" }, correlationId);
}
