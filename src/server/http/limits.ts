import { FixedWindowRateLimiter } from "./rate-limit";

export const launchRateLimiter = new FixedWindowRateLimiter({ limit: 20, windowMs: 10 * 60_000 });
export const feedbackRateLimiter = new FixedWindowRateLimiter({ limit: 10, windowMs: 10 * 60_000 });
export const attachmentRateLimiter = new FixedWindowRateLimiter({ limit: 120, windowMs: 10 * 60_000 });
