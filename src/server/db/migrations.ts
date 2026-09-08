import fs from "node:fs/promises";
import path from "node:path";

import type { Sql } from "postgres";

const upPath = path.join(process.cwd(), "migrations/0001_initial.sql");
const downPath = path.join(process.cwd(), "migrations/0001_down.sql");
const initialMigration = { version: "0001", digest: "pointview-initial-v1" } as const;

async function runFile(sql: Sql, filePath: string) {
  const source = await fs.readFile(filePath, "utf8");
  await sql.unsafe(source);
}

export async function migrateUp(sql: Sql) {
  await sql.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtext('pointview:schema-migrations'))`;
    const [state] = await transaction<{ tableExists: boolean }[]>`
      select to_regclass('public.schema_migrations') is not null as "tableExists"
    `;
    if (state?.tableExists) {
      const [applied] = await transaction<{ digest: string }[]>`
        select digest from schema_migrations where version = ${initialMigration.version}
      `;
      if (applied) {
        if (applied.digest !== initialMigration.digest) {
          throw new Error(`Migration ${initialMigration.version} digest does not match the recorded schema`);
        }
        return;
      }
    }
    const source = await fs.readFile(upPath, "utf8");
    await transaction.unsafe(source);
  });
}

export async function migrateDown(sql: Sql) {
  await runFile(sql, downPath);
}
