import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { processClubLogo, sniffImageType } from "./logo-upload.ts";

const image = (width: number, height: number, alpha = true) =>
  sharp({
    create: { width, height, channels: alpha ? 4 : 3, background: { r: 200, g: 40, b: 40, alpha: alpha ? 0.6 : 1 } },
  });

async function refusal(bytes: Buffer): Promise<string> {
  const outcome = await processClubLogo(bytes);
  return outcome.ok ? "ok" : outcome.code;
}

test("the type comes from the file's first bytes", async () => {
  assert.equal(sniffImageType(await image(300, 300).png().toBuffer()), "image/png");
  assert.equal(sniffImageType(await image(300, 300, false).jpeg().toBuffer()), "image/jpeg");
  assert.equal(sniffImageType(await image(300, 300).webp().toBuffer()), "image/webp");
  assert.equal(sniffImageType(await image(300, 300).gif().toBuffer()), null);
  assert.equal(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniffImageType(Buffer.alloc(0)), null);
});

test("a logo is stored as WebP fitted into 512×512, its aspect ratio kept, never enlarged", async () => {
  const big = await processClubLogo(await image(1024, 768).png().toBuffer());
  assert.ok(big.ok);
  assert.equal(big.logo.contentType, "image/webp");
  assert.deepEqual([big.logo.width, big.logo.height], [512, 384]);
  assert.equal(sniffImageType(big.logo.data), "image/webp");
  assert.match(big.logo.hash, /^[0-9a-f]{64}$/);
  const small = await processClubLogo(await image(300, 260, false).jpeg().toBuffer());
  assert.ok(small.ok);
  assert.deepEqual([small.logo.width, small.logo.height], [300, 260]);
  const meta = await sharp(big.logo.data).metadata();
  assert.equal(meta.hasAlpha, true, "transparency stays");
});

test("GIF, SVG and anything else are refused whatever the request said", async () => {
  assert.equal(await refusal(await image(300, 300).gif().toBuffer()), "LOGO_TYPE");
  assert.equal(await refusal(Buffer.from("<svg></svg>")), "LOGO_TYPE");
  assert.equal(await refusal(Buffer.from("not an image at all")), "LOGO_TYPE");
});

test("size limits: 2 MB, between 256 and 2048 pixels a side, checked before decoding", async () => {
  assert.equal(await refusal(Buffer.alloc(2 * 1024 * 1024 + 1)), "LOGO_TOO_LARGE");
  assert.equal(await refusal(await image(255, 300).png().toBuffer()), "LOGO_DIMENSIONS");
  assert.equal(await refusal(await image(2049, 300).png().toBuffer()), "LOGO_DIMENSIONS");
  // A tiny file that would decode to 9 million pixels (a "pixel bomb") is refused by its header.
  const bomb = await sharp({ create: { width: 3000, height: 3000, channels: 3, background: "#000" } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  assert.ok(bomb.length < 100_000);
  assert.equal(await refusal(bomb), "LOGO_DIMENSIONS");
  assert.equal(await refusal(await image(256, 256).png().toBuffer()), "ok");
  assert.equal(await refusal(await image(2048, 2048, false).jpeg().toBuffer()), "ok");
});

test("animated images and broken files are refused", async () => {
  const frame = (color: string) =>
    sharp({ create: { width: 300, height: 300, channels: 4, background: color } })
      .png()
      .toBuffer();
  const animated = await sharp([await frame("#f00"), await frame("#00f")], { join: { animated: true } })
    .webp({ loop: 0 })
    .toBuffer();
  assert.equal(await refusal(animated), "LOGO_ANIMATED");
  const png = await image(300, 300).png().toBuffer();
  assert.equal(await refusal(Buffer.concat([png.subarray(0, 40), Buffer.alloc(200)])), "LOGO_UNREADABLE");
});

test("the EXIF orientation is applied and every piece of metadata dropped", async () => {
  const rotated = await image(400, 300, false).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const outcome = await processClubLogo(rotated);
  assert.ok(outcome.ok);
  assert.deepEqual([outcome.logo.width, outcome.logo.height], [300, 400], "turned upright");
  const meta = await sharp(outcome.logo.data).metadata();
  assert.equal(meta.exif, undefined);
  assert.equal(meta.orientation, undefined);
});
