import { sqlClient } from "@/server/db/client";
import { operationsSnapshot, renderPrometheus } from "@/server/operations/metrics";

export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(renderPrometheus(await operationsSnapshot(sqlClient())), {
    headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8", "cache-control": "no-store" },
  });
}
