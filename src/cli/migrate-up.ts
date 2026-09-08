import { cliConfig, cliSql } from "@/cli/runtime";
import { migrateUp } from "@/server/db/migrations";

const sql = cliSql(cliConfig().databaseUrl);
try {
  await migrateUp(sql);
  process.stdout.write(`${JSON.stringify({ event: "migration.completed", migration: "0001_initial" })}\n`);
} catch {
  process.stderr.write(`${JSON.stringify({ event: "migration.failed", code: "MIGRATION_FAILED" })}\n`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
