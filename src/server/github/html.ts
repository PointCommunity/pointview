export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function htmlList(items: readonly string[]): string {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

export function verifiedPointViewUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || !["view.pointatx.org", "pointview.eaglepass.io", "pointview-canary.eaglepass.io"].includes(url.hostname)) {
    throw new Error("PointView record URL is invalid");
  }
  return escapeHtml(url.href);
}

