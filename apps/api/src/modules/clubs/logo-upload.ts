// A club logo upload (F6, docs/adr/0013): the real type from the file's first bytes (PNG, JPEG or WebP; no GIF, no
// SVG, whatever the request says), the byte and pixel limits checked before anything is decoded, no animation, then
// the site's one rendition of it (logo-image.ts). Nothing of the upload itself is ever stored or served.

import sharp from "sharp";
import { CLUB_LOGO_LIMITS } from "@ms/shared/clubs";
import { renderLogo, type LogoImage } from "./logo-image.ts";

export type LogoType = "image/png" | "image/jpeg" | "image/webp";

export type LogoRefusalCode = "LOGO_TYPE" | "LOGO_TOO_LARGE" | "LOGO_DIMENSIONS" | "LOGO_ANIMATED" | "LOGO_UNREADABLE";

export type LogoOutcome =
  | { readonly ok: true; readonly logo: LogoImage }
  | { readonly ok: false; readonly code: LogoRefusalCode; readonly message: string };

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
  const { maxBytes, minSide, maxSide } = CLUB_LOGO_LIMITS;
  if (bytes.length > maxBytes) return refuse("LOGO_TOO_LARGE", "The logo may be at most 2 MB.");
  const type = sniffImageType(bytes);
  if (!type) return refuse("LOGO_TYPE", "Upload a PNG, JPG or WebP image.");
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
    return { ok: true, logo: await renderLogo(bytes, maxSide * maxSide) };
  } catch {
    return refuse("LOGO_UNREADABLE", "This image could not be read.");
  }
}
