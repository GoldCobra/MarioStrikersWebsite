// Friend codes as robotic_nightmare and the database keep them: twelve digits written "1234-5678-9012",
// leading zeros included. Also the choices of an MSC code and the rules of the profile editor, which the
// site checks while typing and the API enforces.

export const FRIEND_CODE_PATTERN = /^\d{4}-\d{4}-\d{4}$/;
export const FRIEND_CODE_BLOCK_LENGTH = 4;
export const FRIEND_CODE_BLOCKS = 3;
export const MAX_MSC_CODES = 3;

/** The MSC regions a code can be added for, as the bot offers them (value = dbo.FriendCodes.Region). */
export const MSC_REGIONS = [
  { value: "PAL", label: "PAL (R4QP01)" },
  { value: "NTSC", label: "NTSC-U (R4QE01)" },
] as const;

/** Regions of older MSC codes: they can be kept or deleted, never added. */
export const LEGACY_MSC_REGIONS: Readonly<Record<string, string>> = { JPN: "NTSC-J", KOR: "NTSC-K" };

/** Where an MSC code is played (dbo.FriendCodes.Label), as the bot offers it. */
export const MSC_PLATFORMS = ["Wii", "Wii U", "Dolphin"] as const;

export type MscRegion = (typeof MSC_REGIONS)[number]["value"];
export type MscPlatform = (typeof MSC_PLATFORMS)[number];

export function isMscRegion(value: string): value is MscRegion {
  return MSC_REGIONS.some((region) => region.value === value);
}

export function isMscPlatform(value: string): value is MscPlatform {
  return (MSC_PLATFORMS as readonly string[]).includes(value);
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** "123456789012" → "1234-5678-9012". */
export function formatFriendCode(digits: string): string {
  return `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8, 12)}`;
}

/** The three four-digit fields of a stored code; empty fields for anything else. */
export function friendCodeBlocks(code: string): [string, string, string] {
  if (!FRIEND_CODE_PATTERN.test(code)) return ["", "", ""];
  const digits = digitsOnly(code);
  return [digits.slice(0, 4), digits.slice(4, 8), digits.slice(8, 12)];
}

export type FriendCodeEntry =
  { readonly kind: "empty" } | { readonly kind: "complete"; readonly code: string } | { readonly kind: "incomplete" };

/** What three fields hold: nothing, a whole code, or part of one. */
export function friendCodeFromBlocks(blocks: readonly string[]): FriendCodeEntry {
  const digits = blocks.map((block) => digitsOnly(block)).join("");
  if (!digits) return { kind: "empty" };
  if (digits.length === FRIEND_CODE_BLOCKS * FRIEND_CODE_BLOCK_LENGTH) {
    return { kind: "complete", code: formatFriendCode(digits) };
  }
  return { kind: "incomplete" };
}

/**
 * The digits of a pasted or dropped code. Spaces, dashes, dots and slashes and a leading "SW" (the way
 * Switch shows codes) are ignored; null when anything else is in it, so no letter ever lands in a field.
 */
export function pastedFriendCodeDigits(text: string): string | null {
  const stripped = text
    .trim()
    .replace(/^sw/i, "")
    .replace(/[\s\-./]/g, "");
  return /^\d*$/.test(stripped) ? stripped : null;
}

// ---------------------------------------------------------------------------------------------------
// The profile editor's request: { country, switch_code, msc_codes: [{ region, platform, code }] }.

export interface MscCodeInput {
  readonly region: string;
  readonly platform: string;
  readonly code: string;
}

export interface EditableProfileInput {
  /** A dbo.Enumeration country code, or "" for none. */
  readonly country: string;
  /** "1234-5678-9012", or "" for none. */
  readonly switch_code: string;
  readonly msc_codes: readonly MscCodeInput[];
}

export type FieldErrorCode =
  | "INVALID"
  | "INCOMPLETE"
  | "REGION_REQUIRED"
  | "PLATFORM_REQUIRED"
  | "DUPLICATE"
  | "TOO_MANY"
  | "UNKNOWN_COUNTRY"
  | "TAKEN";

export interface FieldError {
  /** "country", "switch_code", "msc_codes" or "msc_codes.<index>.<region|platform|code>". */
  readonly field: string;
  readonly code: FieldErrorCode;
  readonly message: string;
}

export const FIELD_ERROR_MESSAGES: Readonly<Record<FieldErrorCode, string>> = {
  INVALID: "This value is not valid.",
  INCOMPLETE: "Enter all 12 digits (4 in each field) or leave all three fields empty.",
  REGION_REQUIRED: "Select the MSC region.",
  PLATFORM_REQUIRED: "Select the platform.",
  DUPLICATE: "This friend code is entered twice.",
  TOO_MANY: `At most ${MAX_MSC_CODES} MSC friend codes can be saved.`,
  UNKNOWN_COUNTRY: "Select a country from the list.",
  TAKEN:
    "This friend code is already saved on another profile, so it cannot be added. If it is your code, please contact the MSL staff.",
};

function fieldError(field: string, code: FieldErrorCode): FieldError {
  return { field, code, message: FIELD_ERROR_MESSAGES[code] };
}

function textOf(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value.trim() : null;
}

export interface ValidationOptions {
  /** A selectable country, or the profile's current one (which stays valid even when no longer offered). */
  isAllowedCountry(code: string): boolean;
  /** A legacy MSC code (region JPN or KOR) the profile has now: it may stay, but none can be added. */
  isKeptLegacyCode(region: string, code: string): boolean;
}

export type ValidationResult =
  | { readonly ok: true; readonly value: EditableProfileInput }
  | { readonly ok: false; readonly errors: readonly FieldError[] };

/**
 * The editor's rules: a code is empty or exactly twelve digits; an MSC code also needs its region and its
 * platform; at most three MSC codes, none twice; the country is one of the list. The API applies them to
 * every request, the site already while the dialog is open.
 */
export function validateEditableProfile(raw: unknown, options: ValidationOptions): ValidationResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: [fieldError("request", "INVALID")] };
  }
  const record = raw as Record<string, unknown>;
  const errors: FieldError[] = [];

  const country = textOf(record, "country")?.toLowerCase() ?? null;
  if (country === null) errors.push(fieldError("country", "INVALID"));
  else if (country && !options.isAllowedCountry(country)) errors.push(fieldError("country", "UNKNOWN_COUNTRY"));

  const switchCode = textOf(record, "switch_code");
  if (switchCode === null) errors.push(fieldError("switch_code", "INVALID"));
  else if (switchCode && !FRIEND_CODE_PATTERN.test(switchCode)) {
    errors.push(fieldError("switch_code", digitsOnly(switchCode).length < 12 ? "INCOMPLETE" : "INVALID"));
  }

  const rawCodes = record.msc_codes ?? [];
  const mscCodes: MscCodeInput[] = [];
  if (!Array.isArray(rawCodes)) {
    errors.push(fieldError("msc_codes", "INVALID"));
  } else {
    const seen = new Set<string>();
    rawCodes.forEach((entry: unknown, index) => {
      const at = `msc_codes.${index}`;
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        errors.push(fieldError(at, "INVALID"));
        return;
      }
      const row = entry as Record<string, unknown>;
      const region = textOf(row, "region")?.toUpperCase() ?? null;
      const platform = textOf(row, "platform");
      const code = textOf(row, "code");
      if (region === null || platform === null || code === null) {
        errors.push(fieldError(at, "INVALID"));
        return;
      }
      // A row with nothing in it is no code; the dialog leaves such rows out.
      if (!region && !platform && !code) return;
      if (!code) errors.push(fieldError(`${at}.code`, "INCOMPLETE"));
      else if (!FRIEND_CODE_PATTERN.test(code)) {
        errors.push(fieldError(`${at}.code`, digitsOnly(code).length < 12 ? "INCOMPLETE" : "INVALID"));
      }
      const legacyKept = Object.hasOwn(LEGACY_MSC_REGIONS, region) && options.isKeptLegacyCode(region, code);
      if (!region) errors.push(fieldError(`${at}.region`, "REGION_REQUIRED"));
      else if (!isMscRegion(region) && !legacyKept) errors.push(fieldError(`${at}.region`, "INVALID"));
      if (!platform) errors.push(fieldError(`${at}.platform`, "PLATFORM_REQUIRED"));
      else if (!isMscPlatform(platform)) errors.push(fieldError(`${at}.platform`, "INVALID"));
      if (code && seen.has(code)) errors.push(fieldError(`${at}.code`, "DUPLICATE"));
      if (code) seen.add(code);
      mscCodes.push({ region, platform, code });
    });
    if (mscCodes.length > MAX_MSC_CODES) errors.push(fieldError("msc_codes", "TOO_MANY"));
  }

  if (errors.length || country === null || switchCode === null) return { ok: false, errors };
  return { ok: true, value: { country, switch_code: switchCode, msc_codes: mscCodes } };
}
