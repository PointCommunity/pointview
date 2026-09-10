import { describe, expect, it } from "vitest";

import { readBoundedJson } from "@/server/providers/http";

describe("bounded provider responses", () => {
  it("parses JSON only within the configured byte ceiling", async () => {
    await expect(readBoundedJson(Response.json({ ok: true }), 100)).resolves.toEqual({ ok: true });
    await expect(readBoundedJson(new Response(JSON.stringify({ value: "x".repeat(100) })), 20)).rejects.toThrow(/too large/i);
  });

  it("rejects oversized declared responses before reading their body", async () => {
    await expect(readBoundedJson(new Response("{}", { headers: { "content-length": "1000" } }), 100)).rejects.toThrow(/too large/i);
  });
});
