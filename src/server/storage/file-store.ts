import fs from "node:fs/promises";
import path from "node:path";

import { newId } from "@/server/db/ids";

const objectKeyPattern = /^[0-9a-f]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.bin$/;

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export class FileAttachmentStore {
  readonly #root: string;

  constructor(root: string) {
    if (!path.isAbsolute(root)) throw new Error("Attachment root must be absolute");
    this.#root = path.resolve(root);
  }

  #resolve(key: string): string {
    if (!objectKeyPattern.test(key)) throw new Error("Attachment object key is invalid");
    const resolved = path.resolve(this.#root, key);
    if (!resolved.startsWith(`${this.#root}${path.sep}`)) throw new Error("Attachment object key escapes storage root");
    return resolved;
  }

  async stage(bytes: Buffer) {
    const id = newId();
    const key = `${id.slice(0, 2)}/${id}.bin`;
    const stagingDirectory = path.join(this.#root, ".staging");
    const stagingPath = path.join(stagingDirectory, id);
    const finalPath = this.#resolve(key);
    await fs.mkdir(stagingDirectory, { recursive: true, mode: 0o700 });
    await fs.writeFile(stagingPath, bytes, { flag: "wx", mode: 0o600 });
    let settled = false;
    return {
      key,
      commit: async () => {
        if (settled) return;
        await fs.mkdir(path.dirname(finalPath), { recursive: true, mode: 0o700 });
        await fs.rename(stagingPath, finalPath);
        settled = true;
      },
      abort: async () => {
        if (settled) return;
        try {
          await fs.unlink(stagingPath);
        } catch (error) {
          if (!missing(error)) throw error;
        }
        settled = true;
      },
    };
  }

  async read(key: string): Promise<Buffer> {
    return fs.readFile(this.#resolve(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.#resolve(key));
      return true;
    } catch (error) {
      if (missing(error)) return false;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.#resolve(key));
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
}

