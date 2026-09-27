// Country flags and names for player and club rows.

import { escapeHtml } from "@ms/shared/html";

export { normalizeCountryCode } from "@ms/shared/countries";

// Intl knows no names for the UK home nations and Kosovo.
const NAME_OVERRIDES: Readonly<Record<string, string>> = {
  "gb-eng": "England",
  "gb-wls": "Wales",
  "gb-sct": "Scotland",
  "gb-nir": "Northern Ireland",
  xk: "Kosovo",
};

let regionNames: Intl.DisplayNames | null | undefined;

function englishRegionNames(): Intl.DisplayNames | null {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  return regionNames;
}

/** English name of a flag code ("de" → "Germany"), or "" when unknown. */
export function countryDisplayName(countryCode: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- codes are strings or empty
  const code = String(countryCode || "")
    .trim()
    .toLowerCase()
    .replace(/[_–—]/g, "-");
  const override = Object.hasOwn(NAME_OVERRIDES, code) ? NAME_OVERRIDES[code] : undefined;
  if (override) return override;
  if (!/^[a-z]{2}$/.test(code)) return "";
  const region = code.toUpperCase();
  const name = englishRegionNames()?.of(region);
  return !name || name === region ? "" : name;
}

/** Flag image of a normalized flag code. */
export function flagUrl(countryCode: string): string {
  return `../assets/flags/${countryCode}.png`;
}

/** ` title="Germany"`, or "" when the country has no known name. */
export function flagTitleAttribute(countryCode: string): string {
  const name = countryDisplayName(countryCode);
  return name ? ` title="${escapeHtml(name)}"` : "";
}
