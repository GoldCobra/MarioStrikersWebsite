// The profile page's inline editing as data, without DOM: the one change that is open (the country, the
// Switch code, an MSC code to change, add or delete), the whole profile it asks the API to save, whether it
// changes anything, and what is left of it when the profile was changed elsewhere (in Discord) meanwhile.

import {
  FIELD_ERROR_MESSAGES,
  MAX_MSC_CODES,
  friendCodeBlocks,
  friendCodeFromBlocks,
  validateEditableProfile,
  type EditableProfileInput,
  type MscCodeInput,
} from "@ms/shared/friend-codes";

/** GET/PUT /api/profile/me/editable. */
export interface EditableProfile {
  readonly player_id: number;
  readonly version: string;
  readonly discord: {
    readonly id: string;
    readonly server_name: string;
    readonly username: string;
    readonly global_name: string;
    readonly nick: string;
    readonly membership: "member" | "not_member" | "unknown";
    readonly source: "live" | "login";
  };
  readonly country: string;
  readonly switch_code: string;
  readonly msc_codes: readonly MscCodeInput[];
  readonly countries: readonly { readonly code: string; readonly name: string }[];
}

export type Blocks = readonly [string, string, string];

export const EMPTY_BLOCKS: Blocks = ["", "", ""];

export type Edit =
  | { readonly kind: "country"; readonly country: string }
  | { readonly kind: "switch"; readonly blocks: Blocks }
  /** An MSC code; `original` is the saved code it replaces, null for a new one. */
  | {
      readonly kind: "msc";
      readonly original: string | null;
      readonly region: string;
      readonly platform: string;
      readonly blocks: Blocks;
    }
  | { readonly kind: "msc-delete"; readonly code: string };

/** What a pencil, "+" or "−" opens. */
export type EditTarget =
  | { readonly kind: "country" }
  | { readonly kind: "switch" }
  | { readonly kind: "msc"; readonly code: string | null }
  | { readonly kind: "msc-delete"; readonly code: string };

/** The edit of a target, filled with what is saved. */
export function startEdit(profile: EditableProfile, target: EditTarget): Edit {
  switch (target.kind) {
    case "country":
      return { kind: "country", country: profile.country };
    case "switch":
      return { kind: "switch", blocks: friendCodeBlocks(profile.switch_code) };
    case "msc-delete":
      return { kind: "msc-delete", code: target.code };
    case "msc": {
      const saved = profile.msc_codes.find((entry) => entry.code === target.code);
      return saved
        ? {
            kind: "msc",
            original: saved.code,
            region: saved.region,
            platform: saved.platform,
            blocks: friendCodeBlocks(saved.code),
          }
        : { kind: "msc", original: null, region: "", platform: "", blocks: EMPTY_BLOCKS };
    }
  }
}

function codeOf(blocks: Blocks): string {
  const entry = friendCodeFromBlocks(blocks);
  return entry.kind === "complete" ? entry.code : "";
}

/** The whole profile with the one change, as PUT /api/profile/me/editable takes it (without version). */
export function requestFor(profile: EditableProfile, edit: Edit): EditableProfileInput {
  const saved = { country: profile.country, switch_code: profile.switch_code, msc_codes: profile.msc_codes };
  switch (edit.kind) {
    case "country":
      return { ...saved, country: edit.country };
    case "switch":
      return { ...saved, switch_code: codeOf(edit.blocks) };
    case "msc-delete":
      return { ...saved, msc_codes: profile.msc_codes.filter((entry) => entry.code !== edit.code) };
    case "msc": {
      const row = { region: edit.region, platform: edit.platform, code: codeOf(edit.blocks) };
      const codes =
        edit.original === null
          ? [...profile.msc_codes, row]
          : profile.msc_codes.map((entry) => (entry.code === edit.original ? row : entry));
      return { ...saved, msc_codes: codes };
    }
  }
}

export type EditCheck =
  | { readonly ok: true; readonly request: EditableProfileInput }
  | { readonly ok: false; readonly errors: readonly string[] };

/** The change checked with the rules the API applies; errors are the messages to show at the open line. */
export function checkEdit(profile: EditableProfile, edit: Edit): EditCheck {
  const errors: string[] = [];
  if (edit.kind === "switch" || edit.kind === "msc") {
    const entry = friendCodeFromBlocks(edit.blocks);
    // An MSC code is deleted with "−", so its line needs all 12 digits; the Switch line may be emptied.
    if (entry.kind === "incomplete" || (edit.kind === "msc" && entry.kind === "empty")) {
      errors.push(FIELD_ERROR_MESSAGES.INCOMPLETE);
    }
  }
  const request = requestFor(profile, edit);
  const stored = new Map(profile.msc_codes.map((entry) => [`${entry.region}:${entry.code}`, entry.platform]));
  const checked = validateEditableProfile(request, {
    isAllowedCountry: (code) => code === profile.country || profile.countries.some((country) => country.code === code),
    storedPlatform: (region, code) => stored.get(`${region}:${code}`) ?? null,
  });
  if (!checked.ok) {
    for (const error of checked.errors) {
      // The missing digits are already reported in the form's own words.
      if (error.code === "INCOMPLETE" && errors.length) continue;
      if (!errors.includes(error.message)) errors.push(error.message);
    }
  }
  return errors.length || !checked.ok ? { ok: false, errors } : { ok: true, request: checked.value };
}

/** Whether the open edit would change what is saved, so closing it would drop typed input. */
export function isChanged(profile: EditableProfile, edit: Edit): boolean {
  switch (edit.kind) {
    case "country":
      return edit.country !== profile.country;
    case "switch":
      return edit.blocks.join("") !== friendCodeBlocks(profile.switch_code).join("");
    case "msc-delete":
      return false;
    case "msc": {
      const saved = edit.original === null ? null : profile.msc_codes.find((entry) => entry.code === edit.original);
      if (!saved) return Boolean(edit.region || edit.platform || edit.blocks.join(""));
      return (
        edit.region !== saved.region ||
        edit.platform !== saved.platform ||
        edit.blocks.join("") !== friendCodeBlocks(saved.code).join("")
      );
    }
  }
}

/** Whether "+" can add another MSC code. */
export function canAddMscCode(profile: EditableProfile): boolean {
  return profile.msc_codes.length < MAX_MSC_CODES;
}

/** The saved value an edit is about, in words, e.g. to show what was saved elsewhere meanwhile. */
export function savedText(profile: EditableProfile, edit: Edit, countryName: (code: string) => string): string {
  switch (edit.kind) {
    case "country":
      return profile.country ? countryName(profile.country) : "no country";
    case "switch":
      return profile.switch_code ? `SW-${profile.switch_code}` : "no code";
    case "msc":
    case "msc-delete": {
      const code = edit.kind === "msc" ? edit.original : edit.code;
      const saved = profile.msc_codes.find((entry) => entry.code === code);
      return saved ? `${saved.region}${saved.platform ? ` (${saved.platform})` : ""}: ${saved.code}` : "no code";
    }
  }
}

export interface Rebased {
  /** The edit to keep open, or null when nothing is left of it. */
  readonly edit: Edit | null;
  /** Why it changed or closed, when it did. */
  readonly note: string;
}

/**
 * The open edit on the profile saved elsewhere meanwhile: a change of a code that is gone becomes a new
 * code (if there is room), a deletion of a code that is gone is done already.
 */
export function rebaseEdit(edit: Edit, current: EditableProfile): Rebased {
  if (edit.kind === "msc-delete" && !current.msc_codes.some((entry) => entry.code === edit.code)) {
    return { edit: null, note: "This code was already deleted elsewhere." };
  }
  if (
    edit.kind === "msc" &&
    edit.original !== null &&
    !current.msc_codes.some((entry) => entry.code === edit.original)
  ) {
    if (!canAddMscCode(current)) {
      return { edit: null, note: `This code was removed elsewhere, and ${MAX_MSC_CODES} MSC codes are saved now.` };
    }
    return {
      edit: { ...edit, original: null },
      note: "This code was removed elsewhere; saving adds yours as a new code.",
    };
  }
  if (edit.kind === "msc" && edit.original === null && !canAddMscCode(current)) {
    return { edit: null, note: `${MAX_MSC_CODES} MSC codes are saved now, so no code can be added.` };
  }
  return { edit, note: "" };
}
