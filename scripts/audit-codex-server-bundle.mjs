import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const chunksRoot = join(process.cwd(), ".next", "server", "chunks");
const marker = "Codex sign-in service could not start";
const brokenResolver = /(?:dirname|\.dirname\))\(\d+\),["']bin["'],["']codex\.js["']/;

const entries = await readdir(chunksRoot, { withFileTypes: true });
const chunks = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".js"));
const relevant = [];

for (const chunk of chunks) {
  const path = join(chunksRoot, chunk.name);
  const source = await readFile(path, "utf8");
  if (source.includes(marker)) relevant.push({ path, source });
}

if (relevant.length === 0) throw new Error("The production bundle does not contain the Codex app-server adapter");
for (const { path, source } of relevant) {
  if (brokenResolver.test(source)) throw new Error(`Turbopack replaced the Codex package path with a module ID in ${path}`);
}

process.stdout.write(`Codex server bundle OK: ${relevant.length} route chunks preserve runtime executable resolution.\n`);
