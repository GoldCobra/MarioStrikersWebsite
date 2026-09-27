// Country codes as stored on player profiles, normalized to the flag file names in /assets/flags.
// Free-text entries such as "UK" or "Scotland" map to their ISO or UK home-nation code.

import { normalizeText } from "./text.ts";

export const FLAG_CODE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  uk: "gb",
  "great britain": "gb",
  greatbritain: "gb",
  "united kingdom": "gb",
  unitedkingdom: "gb",
  england: "gb-eng",
  eng: "gb-eng",
  en: "gb-eng",
  "gb-eng": "gb-eng",
  gbeng: "gb-eng",
  "gb-en": "gb-eng",
  gben: "gb-eng",
  scotland: "gb-sct",
  sct: "gb-sct",
  sco: "gb-sct",
  "gb-sct": "gb-sct",
  gbsct: "gb-sct",
  "gb-sco": "gb-sct",
  gbsco: "gb-sct",
  wales: "gb-wls",
  wls: "gb-wls",
  wal: "gb-wls",
  "gb-wls": "gb-wls",
  gbwls: "gb-wls",
  "gb-wal": "gb-wls",
  gbwal: "gb-wls",
  "northern ireland": "gb-nir",
  northernireland: "gb-nir",
  nir: "gb-nir",
  "gb-nir": "gb-nir",
  gbnir: "gb-nir",
  "gb-ni": "gb-nir",
  gbni: "gb-nir",
});

function alias(key: string): string | undefined {
  return Object.hasOwn(FLAG_CODE_ALIASES, key) ? FLAG_CODE_ALIASES[key] : undefined;
}

/** Returns a lower-case flag code ("de", "gb-sct") or "" when the value names no known country. */
export function normalizeCountryCode(value: unknown): string {
  const raw = normalizeText(value).toLowerCase().replace(/[_–—]/g, "-");
  if (!raw) return "";

  const spaced = raw.replace(/[-\s]+/g, " ").trim();
  const dashed = spaced.replace(/\s+/g, "-");
  const compact = spaced.replace(/\s+/g, "");
  const aliased = alias(raw) ?? alias(spaced) ?? alias(dashed) ?? alias(compact);
  if (aliased) return aliased;

  if (/^[a-z]{2}$/.test(dashed)) return dashed;
  if (/^gb-(eng|wls|sct|nir)$/.test(dashed)) return dashed;
  return "";
}
