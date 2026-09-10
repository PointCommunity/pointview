import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { serverConfig } from "@/server/config";

let queryClient: ReturnType<typeof postgres> | undefined;
let database: ReturnType<typeof drizzle> | undefined;

export function sqlClient() {
  queryClient ??= postgres(serverConfig().databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    transform: postgres.camel,
  });
  return queryClient;
}

export function db() {
  database ??= drizzle(sqlClient());
  return database;
}

