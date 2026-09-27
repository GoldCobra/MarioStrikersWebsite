// Signed tokens and cookie helpers. A token is base64url(JSON payload) + "." + HMAC-SHA256; the format
// is unchanged from the previous API, so existing sessions stay valid across the rewrite.

import crypto from "node:crypto";
import { normalizeText, toText } from "@ms/shared/text";

export const DEFAULT_RETURN_TO = "/profile";
const LOCAL_ORIGIN = "https://mariostrikers.local";

function hmac(value: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createSignedToken(payload: Readonly<Record<string, unknown>>, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(body, secret)}`;
}

/** The payload of a valid, unexpired token; null otherwise. A token without expires_at never expires. */
export function verifySignedToken(
  token: unknown,
  secret: string,
  now: number = Date.now(),
): Record<string, unknown> | null {
  const parts = toText(token).split(".");
  const [body, signature] = parts;
  if (parts.length !== 2 || !body || !signature || !safeEqual(signature, hmac(body, secret))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const expiresAt = Number((payload as Record<string, unknown>).expires_at ?? 0);
    return expiresAt && now > expiresAt ? null : (payload as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** Cookie header values by name; malformed entries (including other applications' cookies) are skipped. */
export function parseCookies(cookieHeader: unknown): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const entry of toText(cookieHeader).split(";")) {
    const index = entry.indexOf("=");
    if (index === -1) continue;
    const key = entry.slice(0, index).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(entry.slice(index + 1).trim());
    } catch {
      // Ignore undecodable values.
    }
  }
  return cookies;
}

export interface CookieOptions {
  readonly maxAgeSeconds?: number;
  readonly expires?: Date;
  readonly path?: string;
  readonly secure: boolean;
}

/** HttpOnly, SameSite=Lax cookie in the attribute order the previous API used. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  parts.push(`Path=${options.path ?? "/"}`, "HttpOnly");
  if (options.secure) parts.push("Secure");
  parts.push("SameSite=Lax");
  return parts.join("; ");
}

/** A same-site path to return to after login; anything external, protocol-relative or under /api/ becomes /profile. */
export function normalizeReturnTo(value: unknown): string {
  const raw = normalizeText(value);
  if (!raw || raw.length > 512 || /[\r\n]/.test(raw) || !raw.startsWith("/") || raw.startsWith("//")) {
    return DEFAULT_RETURN_TO;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw, LOCAL_ORIGIN);
  } catch {
    return DEFAULT_RETURN_TO;
  }
  if (parsed.origin !== LOCAL_ORIGIN || parsed.pathname.startsWith("/api/")) return DEFAULT_RETURN_TO;
  return parsed.pathname + parsed.search + parsed.hash;
}

export function appendQuery(path: string, params: Readonly<Record<string, string>>): string {
  const parsed = new URL(path, LOCAL_ORIGIN);
  for (const [key, value] of Object.entries(params)) {
    if (value) parsed.searchParams.set(key, value);
  }
  return parsed.pathname + parsed.search + parsed.hash;
}
