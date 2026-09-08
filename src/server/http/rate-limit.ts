type RateLimitOptions = {
  limit: number;
  windowMs: number;
  now?: () => number;
};

type Bucket = { count: number; resetAt: number };

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: number;
};

export class FixedWindowRateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #now: () => number;

  constructor(options: RateLimitOptions) {
    if (!Number.isInteger(options.limit) || options.limit < 1) throw new Error("Rate limit must be positive");
    if (!Number.isInteger(options.windowMs) || options.windowMs < 1) throw new Error("Rate window must be positive");
    this.#limit = options.limit;
    this.#windowMs = options.windowMs;
    this.#now = options.now ?? Date.now;
  }

  consume(key: string): RateLimitResult {
    const now = this.#now();
    let bucket = this.#buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + this.#windowMs };
      this.#buckets.set(key, bucket);
    }
    const allowed = bucket.count < this.#limit;
    if (allowed) bucket.count += 1;
    return {
      allowed,
      limit: this.#limit,
      remaining: Math.max(0, this.#limit - bucket.count),
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
      resetAt: bucket.resetAt,
    };
  }
}

export function rateLimitHeaders(result: RateLimitResult): HeadersInit {
  return {
    "x-ratelimit-limit": String(result.limit),
    "x-ratelimit-remaining": String(result.remaining),
    "x-ratelimit-reset": String(Math.ceil(result.resetAt / 1_000)),
    ...(result.allowed ? {} : { "retry-after": String(result.retryAfterSeconds) }),
  };
}

