import { createHash } from "node:crypto";

export type WebSource = { id: string; url: string; title: string };

export function normalizeWebSourceUrl(value: string): string | null {
  try {
    if (value.length > 2_000) return null;
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export function webSourceId(url: string): string {
  return `ev_web_${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
}
