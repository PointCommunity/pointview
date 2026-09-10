import { createHash } from "node:crypto";
import path from "node:path";

import sharp from "sharp";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const allowed = {
  "image/png": { format: "png", extensions: new Set([".png"]) },
  "image/jpeg": { format: "jpeg", extensions: new Set([".jpg", ".jpeg"]) },
  "image/webp": { format: "webp", extensions: new Set([".webp"]) },
} as const;

type AllowedMime = keyof typeof allowed;

function actualMime(bytes: Buffer): AllowedMime | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return undefined;
}

function safeDisplayName(name: string): string {
  const withoutControls = name.replace(/[\u0000-\u001f\u007f]/g, "");
  const basename = path.basename(withoutControls.replaceAll("\\", "/")).trim();
  if (!basename || basename.length > 255) throw new Error("Screenshot filename is invalid");
  return basename;
}

export function validateAttachmentCount(count: number): void {
  if (!Number.isInteger(count) || count < 0 || count > 5) throw new Error("At most five screenshots are allowed");
}

export async function normalizeScreenshot(input: { bytes: Buffer; originalName: string; claimedMime: string }) {
  if (!(input.claimedMime in allowed)) throw new Error("Screenshot type is unsupported");
  if (input.bytes.length < 1 || input.bytes.length > MAX_BYTES) throw new Error("Screenshot exceeds the 10 MiB limit");
  const mime = input.claimedMime as AllowedMime;
  const displayName = safeDisplayName(input.originalName);
  if (!allowed[mime].extensions.has(path.extname(displayName).toLowerCase() as never)) {
    throw new Error("Screenshot filename extension does not match its MIME type");
  }
  if (actualMime(input.bytes) !== mime) throw new Error("Screenshot magic bytes do not match its MIME type");

  const decoder = sharp(input.bytes, { failOn: "warning", limitInputPixels: MAX_PIXELS, animated: false });
  const metadata = await decoder.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height || width > 12_000 || height > 12_000 || width * height > MAX_PIXELS) {
    throw new Error("Screenshot dimensions are outside the allowed range");
  }
  if ((metadata.pages ?? 1) !== 1) throw new Error("Animated or multi-page screenshots are unsupported");

  let pipeline = decoder.rotate();
  if (mime === "image/png") pipeline = pipeline.png({ compressionLevel: 9 });
  if (mime === "image/jpeg") pipeline = pipeline.jpeg({ quality: 90, mozjpeg: true });
  if (mime === "image/webp") pipeline = pipeline.webp({ quality: 90 });
  const bytes = await pipeline.toBuffer();
  if (bytes.length > MAX_BYTES) throw new Error("Normalized screenshot exceeds the 10 MiB limit");
  return {
    bytes,
    displayName,
    mimeType: mime,
    byteSize: bytes.length,
    width,
    height,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

