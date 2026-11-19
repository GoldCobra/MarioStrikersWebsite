// A club logo upload (F6, docs/adr/0013): the real type from the file's first bytes (PNG, JPEG or WebP; no GIF, no
// SVG, whatever the request says), the byte and pixel limits checked before anything is decoded, no animation, then
// decoded and encoded anew — turned by its EXIF orientation, fitted into 512×512 with its aspect ratio, every piece
// of metadata dropped — as a high-quality WebP. Nothing of the upload itself is ever stored or served.

import { createHash } from "node:crypto";
import sharp from "sharp";
import { CLUB_LOGO_LIMITS } from "@ms/shared/clubs";

export type LogoType = "image/png" | "image/jpeg" | "image/webp";

export interface ProcessedLogo {
  readonly contentType: "image/webp";
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
  /** SHA-256 of the stored image (hex); part of the logo's URL, so browsers may keep it forever. */
  readonly hash: string;
}

export type LogoRefusalCode = "LOGO_TYPE" | "LOGO_TOO_LARGE" | "LOGO_DIMENSIONS" | "LOGO_ANIMATED" | "LOGO_UNREADABLE";

export type LogoOutcome =
  | { readonly ok: true; readonly logo: ProcessedLogo }
  | { readonly ok: false; readonly code: LogoRefusalCode; readonly message: string };

/** The site's image pipeline (the nav buttons): WebP at quality 98, the alpha channel lossless. */
const WEBP_OPTIONS = { quality: 98, alphaQuality: 100, effort: 6 } as const;

/** The image type the bytes start with, or null for anything else (GIF, SVG, …). */
export function sniffImageType(bytes: Uint8Array): LogoType | null {
  const starts = (signature: readonly number[], offset = 0): boolean =>
    signature.every((byte, index) => bytes[offset + index] === byte);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

const FORMATS: Readonly<Record<LogoType, string>> = { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp" };

function refuse(code: LogoRefusalCode, message: string): LogoOutcome {
  return { ok: false, code, message };
}

export async function processClubLogo(bytes: Buffer): Promise<LogoOutcome> {
  const { maxBytes, minSide, maxSide, outputSide } = CLUB_LOGO_LIMITS;
  if (bytes.length > maxBytes) return refuse("LOGO_TOO_LARGE", "The logo may be at most 2 MB.");
  const type = sniffImageType(bytes);
  if (!type) return refuse("LOGO_TYPE", "Upload a PNG, JPG or WebP image.");
  const limits = { limitInputPixels: maxSide * maxSide, failOn: "error" } as const;
  let width: number;
  let height: number;
  try {
    // The header only (sharp's default limit; no pixel is decoded): dimensions and frames are known first, so an
    // oversized image gets its own message before the strict limit below would refuse to decode it.
    const meta = await sharp(bytes, { failOn: "error" }).metadata();
    if (meta.format !== FORMATS[type]) return refuse("LOGO_TYPE", "Upload a PNG, JPG or WebP image.");
    if ((meta.pages ?? 1) > 1) return refuse("LOGO_ANIMATED", "Animated images cannot be used as a logo.");
    width = meta.width;
    height = meta.height;
  } catch {
    return refuse("LOGO_UNREADABLE", "This image could not be read.");
  }
  if (width < minSide || height < minSide || width > maxSide || height > maxSide) {
    return refuse(
      "LOGO_DIMENSIONS",
      `The logo must be between ${minSide}×${minSide} and ${maxSide}×${maxSide} pixels.`,
    );
  }
  try {
    const { data, info } = await sharp(bytes, limits)
      .rotate()
      .resize(outputSide, outputSide, { fit: "inside", withoutEnlargement: true })
      .webp(WEBP_OPTIONS)
      .toBuffer({ resolveWithObject: true });
    return {
      ok: true,
      logo: {
        contentType: "image/webp",
        data,
        width: info.width,
        height: info.height,
        hash: createHash("sha256").update(data).digest("hex"),
      },
    };
  } catch {
    return refuse("LOGO_UNREADABLE", "This image could not be read.");
  }
}
