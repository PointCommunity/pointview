import { createHash } from "node:crypto";

import type postgres from "postgres";

import { newId } from "@/server/db/ids";
import type { WebSource } from "@/server/triage/model/web-sources";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

export async function persistWebSources(
  sql: postgres.Sql | postgres.TransactionSql,
  input: { unitId: string; sources: WebSource[]; capturedAt?: Date },
): Promise<void> {
  const capturedAt = input.capturedAt ?? new Date();
  for (const source of input.sources) {
    const facts = { evidenceId: source.id, url: source.url, title: source.title };
    const url = new URL(source.url);
    await sql`
      insert into research_captures (
        id, unit_id, kind, source_locator, title, publisher, captured_at, applicability,
        facts, content_digest, eligible, provenance
      ) values (
        ${newId()}, ${input.unitId}, 'WEB', ${source.url}, ${source.title}, ${url.hostname}, ${capturedAt},
        'Returned by hosted web search for this decision run', ${sql.json(facts)},
        ${createHash("sha256").update(canonical(facts)).digest("hex")}, true,
        ${sql.json({ adapter: "openai-responses-web-search", capturedSourceList: true })}
      )
      on conflict (unit_id, kind, source_locator) do nothing
    `;
  }
}
