import "server-only";

import pino from "pino";

const redactedKeys = /(?:authorization|cookie|token|secret|password|private.?key|feedback.?text|raw.?content|image.?bytes|screenshot)/i;

export function redactLogValue(value: unknown, key = ""): unknown {
  if (redactedKeys.test(key)) return "[REDACTED]";
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactLogValue(entryValue, entryKey)]),
    );
  }
  return value;
}

export const logger = pino({
  base: undefined,
  level: process.env.LOG_LEVEL ?? "info",
  serializers: { err: pino.stdSerializers.err },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.token",
      "*.secret",
      "*.password",
      "*.privateKey",
      "*.feedbackText",
      "*.rawContent",
      "*.imageBytes",
      "*.screenshot",
    ],
    censor: "[REDACTED]",
  },
});

