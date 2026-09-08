import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileAttachmentStore } from "@/server/storage/file-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("private file attachment store", () => {
  it("stages, commits, reads, verifies, and deletes generated keys", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pointview-storage-"));
    roots.push(root);
    const store = new FileAttachmentStore(root);
    const staged = await store.stage(Buffer.from("normalized-image"));
    expect(staged.key).toMatch(/^[0-9a-f]{2}\/[0-9a-f-]+\.bin$/);
    await staged.commit();
    await expect(store.read(staged.key)).resolves.toEqual(Buffer.from("normalized-image"));
    await store.delete(staged.key);
    await expect(store.exists(staged.key)).resolves.toBe(false);
  });

  it("rejects traversal and absolute object keys", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pointview-storage-"));
    roots.push(root);
    const store = new FileAttachmentStore(root);
    await expect(store.read("../secret")).rejects.toThrow(/key/i);
    await expect(store.read("/etc/passwd")).rejects.toThrow(/key/i);
  });
});
