import postgres from "postgres";

import { parseServerConfig } from "@/server/config/server";

export function cliConfig() {
  return parseServerConfig(process.env);
}

export function cliSql(databaseUrl: string) {
  return postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    transform: postgres.camel,
  });
}
