import fs from "node:fs/promises";
import path from "node:path";

import type { Sql } from "postgres";

const upPath = path.join(process.cwd(), "migrations/0001_initial.sql");
const downPath = path.join(process.cwd(), "migrations/0001_down.sql");

async function runFile(sql: Sql, filePath: string) {
  const source = await fs.readFile(filePath, "utf8");
  await sql.unsafe(source);
}

export async function migrateUp(sql: Sql) {
  await runFile(sql, upPath);
}

export async function migrateDown(sql: Sql) {
  await runFile(sql, downPath);
}

