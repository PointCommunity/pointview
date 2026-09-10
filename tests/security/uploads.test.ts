import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { normalizeScreenshot, validateAttachmentCount } from "@/server/feedback/images";

describe("screenshot normalization", () => {
  it("decodes, re-encodes, strips metadata, and hashes an allowed image", async () => {
    const input = await sharp({
      create: { width: 4, height: 3, channels: 4, background: { r: 20, g: 80, b: 140, alpha: 1 } },
    })
      .png()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const normalized = await normalizeScreenshot({ bytes: input, originalName: "screen\u0000shot.png", claimedMime: "image/png" });
    expect(normalized).toMatchObject({ displayName: "screenshot.png", mimeType: "image/png", width: 4, height: 3 });
    expect(normalized.sha256).toMatch(/^[0-9a-f]{64}$/);
    const metadata = await sharp(normalized.bytes).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
  });

  it("rejects type confusion and unsupported active content", async () => {
    const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).jpeg().toBuffer();
    await expect(normalizeScreenshot({ bytes: jpeg, originalName: "fake.png", claimedMime: "image/png" })).rejects.toThrow(/match/i);
    await expect(
      normalizeScreenshot({ bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), originalName: "x.svg", claimedMime: "image/svg+xml" }),
    ).rejects.toThrow(/unsupported/i);
  });

  it("enforces the five-image boundary", () => {
    expect(() => validateAttachmentCount(5)).not.toThrow();
    expect(() => validateAttachmentCount(6)).toThrow(/five/i);
  });
});
