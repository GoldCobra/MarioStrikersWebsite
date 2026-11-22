// The one rendition of every club logo the site serves (docs/adr/0013): turned by its EXIF orientation, fitted into
// 512×512 with its aspect ratio, every piece of metadata dropped, encoded as a high-quality WebP. Uploads
// (logo-upload.ts) and logos cached from a club's link (logo-cache.ts) both come out of here.

import { createHash } from "node:crypto";
import sharp from "sharp";
import { CLUB_LOGO_LIMITS } from "@ms/shared/clubs";

export interface LogoImage {
  readonly contentType: "image/webp";
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
  /** SHA-256 of the encoded image (hex); part of the logo's URL, so browsers may keep it forever. */
  readonly hash: string;
}

/** What the decoder may read; anything else (SVG, TIFF, …) is refused whatever its file or response claims. */
const FORMATS = new Set(["png", "jpeg", "webp", "gif"]);

/**
 * The site's image settings (the nav buttons): WebP at quality 98, the alpha channel lossless. Effort 5, not 6: on the
 * server, 6 took 2–4.5 s for every logo with transparency (5 takes 20–170 ms) and saved about 1 % of the bytes.
 */
const WEBP_OPTIONS = { quality: 98, alphaQuality: 100, effort: 5 } as const;

/**
 * Decodes `bytes` (PNG, JPEG, WebP or GIF; of an animation only the first frame) and encodes the rendition. Rejects
 * when the image cannot be read, has another format or more than `maxInputPixels` pixels.
 */
export async function renderLogo(bytes: Buffer, maxInputPixels: number): Promise<LogoImage> {
  const image = sharp(bytes, { limitInputPixels: maxInputPixels, failOn: "error" });
  const { format } = await image.metadata();
  if (!FORMATS.has(format)) throw new Error(`Unsupported image format: ${format}.`);
  const { data, info } = await image
    .rotate()
    .resize(CLUB_LOGO_LIMITS.outputSide, CLUB_LOGO_LIMITS.outputSide, { fit: "inside", withoutEnlargement: true })
    .webp(WEBP_OPTIONS)
    .toBuffer({ resolveWithObject: true });
  return {
    contentType: "image/webp",
    data,
    width: info.width,
    height: info.height,
    hash: createHash("sha256").update(data).digest("hex"),
  };
}
