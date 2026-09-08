import "server-only";

import { parseServerConfig } from "./server";

let cached: ReturnType<typeof parseServerConfig> | undefined;

export function serverConfig() {
  cached ??= parseServerConfig(process.env);
  return cached;
}

