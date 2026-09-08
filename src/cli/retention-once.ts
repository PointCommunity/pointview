import { serverConfig } from "@/server/config";
import { sqlClient } from "@/server/db/client";
import { runRetention } from "@/server/retention/run";
import { FileAttachmentStore } from "@/server/storage/file-store";

const config = serverConfig();
const sql = sqlClient();
try {
  const result = await runRetention(sql, new FileAttachmentStore(config.attachmentRoot));
  process.stdout.write(`${JSON.stringify({ event: "retention.completed", ...result })}\n`);
  if (result.failed > 0) process.exitCode = 1;
} catch {
  process.stderr.write(`${JSON.stringify({ event: "retention.failed", code: "RETENTION_JOB_FAILED" })}\n`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
