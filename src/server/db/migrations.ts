import fs from "node:fs/promises";
import path from "node:path";

import type { Sql } from "postgres";

const migrations = [
  { version: "0001", digest: "pointview-initial-v1", up: "0001_initial.sql", down: "0001_down.sql" },
  { version: "0002", digest: "pointview-provider-connections-v1", up: "0002_provider_connections.sql", down: "0002_down.sql" },
  { version: "0003", digest: "pointview-requeue-generations-v1", up: "0003_requeue_generations.sql", down: "0003_down.sql" },
] as const;

async function runFile(sql: Pick<Sql, "unsafe">, filePath: string) {
  const source = await fs.readFile(filePath, "utf8");
  await sql.unsafe(source);
}

export async function migrateUp(sql: Sql) {
  await sql.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtext('pointview:schema-migrations'))`;
    for (const migration of migrations) {
      const [state] = await transaction<{ tableExists: boolean }[]>`
        select to_regclass('public.schema_migrations') is not null as "tableExists"
      `;
      if (state?.tableExists) {
        const [applied] = await transaction<{ digest: string }[]>`
          select digest from schema_migrations where version = ${migration.version}
        `;
        if (applied) {
          if (applied.digest !== migration.digest) {
            throw new Error(`Migration ${migration.version} digest does not match the recorded schema`);
          }
          continue;
        }
      }
      await runFile(transaction, path.join(process.cwd(), "migrations", migration.up));
    }
  });
}

export async function migrateDown(sql: Sql) {
  for (const migration of [...migrations].reverse()) {
    await runFile(sql, path.join(process.cwd(), "migrations", migration.down));
  }
}
