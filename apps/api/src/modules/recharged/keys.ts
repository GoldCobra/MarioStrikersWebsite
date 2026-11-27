// The Recharged API's keys (docs/adr/0016). A key is "rch_<environment>_" and 43 base64url characters (256 random
// bits); the server keeps only its SHA-256 (RECHARGED_API_KEYS: "test:<64 hex>,live:<64 hex>"). A request presents
// the key itself as "Authorization: Bearer <key>", a header the logger redacts. Its digest is compared with every
// configured one in constant time, also after a match, so the answer takes as long whichever key matches, or none.

import crypto from "node:crypto";

/** A test key's reports are kept apart and never rated; a live key's are the real ones. */
export type KeyEnvironment = "test" | "live";

export interface ApiKey {
  readonly environment: KeyEnvironment;
  /** The key's SHA-256. */
  readonly digest: Buffer;
}

const ENTRY = /^(test|live):([0-9a-f]{64})$/;
const BEARER = /^Bearer\s+(\S+)$/i;

export function digestApiKey(key: string): Buffer {
  return crypto.createHash("sha256").update(key, "utf8").digest();
}

/** The configured keys, and what is wrong with the setting: positions of entries only, never a value. */
export function parseApiKeys(entries: readonly string[]): { keys: ApiKey[]; problems: string[] } {
  const keys: ApiKey[] = [];
  const problems: string[] = [];
  entries.forEach((entry, index) => {
    const match = ENTRY.exec(entry.trim().toLowerCase());
    const environment = match?.[1];
    const hex = match?.[2];
    if ((environment !== "test" && environment !== "live") || !hex) {
      problems.push(`entry ${String(index + 1)} is not test:<sha256 hex> or live:<sha256 hex>`);
      return;
    }
    const digest = Buffer.from(hex, "hex");
    if (keys.some((key) => key.digest.equals(digest))) {
      problems.push(`entry ${String(index + 1)} repeats a key`);
      return;
    }
    keys.push({ environment, digest });
  });
  return { keys, problems };
}

/** The configured key the Authorization header presents, or null. */
export function findApiKey(authorization: unknown, keys: readonly ApiKey[]): ApiKey | null {
  const presented = typeof authorization === "string" ? BEARER.exec(authorization.trim())?.[1] : undefined;
  if (!presented) return null;
  const digest = digestApiKey(presented);
  let found: ApiKey | null = null;
  for (const key of keys) {
    if (crypto.timingSafeEqual(digest, key.digest) && !found) found = key;
  }
  return found;
}

/** A new key and its RECHARGED_API_KEYS entry (npm run ops:recharged-key). */
export function generateApiKey(environment: KeyEnvironment): { key: string; entry: string } {
  const key = `rch_${environment}_${crypto.randomBytes(32).toString("base64url")}`;
  return { key, entry: `${environment}:${digestApiKey(key).toString("hex")}` };
}
