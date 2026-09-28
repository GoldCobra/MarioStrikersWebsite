// Globals the legacy scripts in public/js still read. Each one goes when its last reader is a module.

import { FLAG_CODE_ALIASES, normalizeCountryCode } from "@ms/shared/countries";
import { fetchJson } from "./api.ts";
import { countryDisplayName } from "./countries.ts";

declare global {
  interface Window {
    /** Read by msbl-clubs-engine.js. */
    PublicDataPreload?: { fetchJson(url: string): Promise<unknown> };
    /** Read by msbl-clubs-engine.js. */
    MSCFlags?: { FLAG_CODE_ALIASES: typeof FLAG_CODE_ALIASES; normalizeCountryCode(code: unknown): string };
    /** Read by msbl-clubs-engine.js. */
    MSCCountryDisplayNames?: { getCountryDisplayName(code: unknown): string };
  }
}

export function exposePublicData(): void {
  window.PublicDataPreload = { fetchJson };
}

export function exposeCountries(): void {
  window.MSCFlags = Object.freeze({ FLAG_CODE_ALIASES, normalizeCountryCode });
  window.MSCCountryDisplayNames = Object.freeze({ getCountryDisplayName: countryDisplayName });
}
