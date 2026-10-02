// The country field's options for the site's dropdown (lib/dropdown.ts): every country once with its flag
// from /assets/flags, as a native <select> cannot show images and Windows draws no flag emoji.

import { escapeHtml } from "@ms/shared/html";
import { countryDisplayName, flagUrl, normalizeCountryCode } from "../../lib/countries.ts";
import type { DropdownOption } from "../../lib/dropdown.ts";

export interface CountryOption extends DropdownOption {
  /** The value the API takes (dbo.Enumeration's code, e.g. "de", "england"); "" for no country. */
  readonly value: string;
  /** The flag file's code ("de", "gb-eng"), "" when there is none. */
  readonly flag: string;
}

export const NO_COUNTRY_LABEL = "No country";

/** A country's name as the site shows it: English, from its flag code; else the list's own name. */
export function countryLabel(code: string, fallback = ""): string {
  return countryDisplayName(normalizeCountryCode(code)) || fallback || code;
}

/** A flag in a fixed 27 x 18 box (an empty box without one), so the name after it never moves. */
export function flagImage(flag: string, className = "profile-country-flag"): string {
  return flag
    ? `<img class="${className}" src="${escapeHtml(flagUrl(flag))}" width="27" height="18" alt="" loading="lazy">`
    : `<span class="${className} is-empty" aria-hidden="true"></span>`;
}

/** A country as a field shows it (the profile's line, the dropdown's field and options): flag, then name. */
export function countryHtml(flag: string, label: string): string {
  return `${flagImage(flag)}<span class="dropdown-text">${escapeHtml(label)}</span>`;
}

/** "No country", then every country once, alphabetically by the shown name. */
export function countryOptions(
  countries: readonly { readonly code: string; readonly name: string }[],
): CountryOption[] {
  const seen = new Set<string>();
  const options: { value: string; label: string; flag: string }[] = [];
  for (const country of countries) {
    if (!country.code || seen.has(country.code)) continue;
    seen.add(country.code);
    options.push({
      value: country.code,
      label: countryLabel(country.code, country.name),
      flag: normalizeCountryCode(country.code),
    });
  }
  options.sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
  return [{ value: "", label: NO_COUNTRY_LABEL, flag: "" }, ...options].map((option) => ({
    ...option,
    html: countryHtml(option.flag, option.label),
  }));
}
