import { describe, expect, it } from "vitest";

import { newId } from "@/server/db/ids";
import { updateVersioned } from "@/server/db/optimistic";

describe("database primitives", () => {
  it("creates UUIDv7 identifiers", () => {
    const id = newId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("rejects stale optimistic updates", () => {
    const current = { version: 3, name: "before" };
    expect(updateVersioned(current, 3, { name: "after" })).toEqual({ version: 4, name: "after" });
    expect(() => updateVersioned(current, 2, { name: "stale" })).toThrow(/version/i);
  });
});
