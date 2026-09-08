import { AuthenticationError } from "@/server/auth/request";
import { CsrfError } from "@/server/auth/csrf";
import { FeedbackError } from "@/server/feedback/service";

import { problem } from "./problem";

export function routeError(error: unknown, correlationId: string): Response {
  if (error instanceof AuthenticationError || error instanceof FeedbackError || error instanceof CsrfError) {
    return problem({ status: error.status, title: error.message, code: error.code }, correlationId);
  }
  return problem({ status: 500, title: "The request could not be completed", code: "INTERNAL_ERROR" }, correlationId);
}
