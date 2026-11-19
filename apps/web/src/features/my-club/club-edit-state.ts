// My Club's editing as data, without DOM (club-edit.ts shows it): the draft of a club's settings (and of a new
// club's name and tag), which of its fields differ from what is saved, the request SAVE or CREATE sends, the
// errors of each field, and what is left of the draft when another officer saved the settings meanwhile. The
// checks are the shared club rules (@ms/shared/clubs), so the page says what the API would say.

import {
  MAX_CLUB_CODES,
  MAX_CLUB_REGIONS,
  validateClubSettings,
  validateNewClub,
  type ClubFieldError,
  type ClubSettingsValue,
} from "@ms/shared/clubs";

/** One key per line of the form. */
export type ClubField = "name" | "tag" | "status" | "regions" | "codes" | "uniforms" | "stadium" | "discord";

/** The lines of a club's settings, in the order of the page. */
export const SETTINGS_FIELDS: readonly ClubField[] = ["status", "regions", "codes", "uniforms", "stadium", "discord"];

/** The lines of a new club: its name and tag, then its settings. */
export const NEW_CLUB_FIELDS: readonly ClubField[] = ["name", "tag", ...SETTINGS_FIELDS];

export interface ClubDraft {
  readonly name: string;
  readonly tag: string;
  /** null until a new club's status is chosen. */
  readonly isOpen: boolean | null;
  /** One entry per region line; "" for a line added and not chosen yet. */
  readonly regions: readonly string[];
  /** One entry per club code line; "" for a line added and not filled yet. */
  readonly codes: readonly string[];
  readonly firstUniform: string;
  readonly secondUniform: string;
  readonly stadium: string;
  readonly discordUrl: string;
}

/** A new club starts without a choice: the status, one region line and one club code line wait for input. */
export const NEW_CLUB_DRAFT: ClubDraft = {
  name: "",
  tag: "",
  isOpen: null,
  regions: [""],
  codes: [""],
  firstUniform: "",
  secondUniform: "",
  stadium: "",
  discordUrl: "",
};

export function createDraft(saved: ClubSettingsValue): ClubDraft {
  return {
    name: "",
    tag: "",
    isOpen: saved.isOpen,
    regions: [...saved.regions],
    codes: [...saved.clubCodes],
    firstUniform: saved.firstUniform,
    secondUniform: saved.secondUniform,
    stadium: saved.stadium,
    discordUrl: saved.discordUrl,
  };
}

function filled(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Whether a list line can be added (at most three regions and three club codes). */
export function canAddLine(draft: ClubDraft, field: "regions" | "codes"): boolean {
  return field === "regions" ? draft.regions.length < MAX_CLUB_REGIONS : draft.codes.length < MAX_CLUB_CODES;
}

/** The lines left empty go when their field closes. */
export function withoutBlankLines(draft: ClubDraft, field: ClubField): ClubDraft {
  if (field === "regions") return { ...draft, regions: filled(draft.regions) };
  if (field === "codes") return { ...draft, codes: filled(draft.codes) };
  return draft;
}

function sameField(a: ClubDraft, b: ClubDraft, field: ClubField): boolean {
  switch (field) {
    case "name":
      return a.name.trim() === b.name.trim();
    case "tag":
      return a.tag.trim() === b.tag.trim();
    case "status":
      return a.isOpen === b.isOpen;
    case "regions":
      return sameList(filled(a.regions), filled(b.regions));
    case "codes":
      return sameList(filled(a.codes), filled(b.codes));
    case "uniforms":
      return a.firstUniform === b.firstUniform && a.secondUniform === b.secondUniform;
    case "stadium":
      return a.stadium === b.stadium;
    case "discord":
      return a.discordUrl.trim() === b.discordUrl.trim();
  }
}

/** The settings lines whose value differs from what is saved (a blank added line changes nothing). */
export function changedFields(draft: ClubDraft, saved: ClubSettingsValue): Set<ClubField> {
  const base = createDraft(saved);
  return new Set(SETTINGS_FIELDS.filter((field) => !sameField(draft, base, field)));
}

/** The settings as the API takes them (PUT /api/my-club/settings adds the version, create adds name and tag). */
export function settingsRequest(draft: ClubDraft): Record<string, unknown> {
  return {
    is_open: draft.isOpen,
    regions: filled(draft.regions),
    club_codes: filled(draft.codes),
    first_uniform: draft.firstUniform,
    second_uniform: draft.secondUniform,
    stadium: draft.stadium,
    discord_url: draft.discordUrl.trim(),
  };
}

/** The line an API field error belongs to ("club_codes.1" → "codes"); null for the request as a whole. */
export function fieldOfError(path: string): ClubField | null {
  switch (path.split(".")[0]) {
    case "name":
      return "name";
    case "tag":
      return "tag";
    case "is_open":
      return "status";
    case "regions":
      return "regions";
    case "club_codes":
      return "codes";
    case "uniforms":
      return "uniforms";
    case "stadium":
      return "stadium";
    case "discord_url":
      return "discord";
    default:
      return null;
  }
}

export type FieldErrors = ReadonlyMap<ClubField, readonly string[]>;

/** The errors of each line, each message once. */
export function errorsByField(errors: readonly Pick<ClubFieldError, "field" | "message">[]): FieldErrors {
  const map = new Map<ClubField, string[]>();
  for (const error of errors) {
    const field = fieldOfError(error.field);
    if (!field) continue;
    const messages = map.get(field) ?? [];
    if (!messages.includes(error.message)) messages.push(error.message);
    map.set(field, messages);
  }
  return map;
}

export type DraftCheck =
  | { readonly ok: true; readonly request: Record<string, unknown> }
  | { readonly ok: false; readonly errors: FieldErrors };

/** The settings SAVE sends, checked against what is saved (an older uniform pair, stadium or link may stay). */
export function checkSettings(draft: ClubDraft, saved: ClubSettingsValue): DraftCheck {
  const request = settingsRequest(draft);
  const result = validateClubSettings(request, saved);
  return result.ok ? { ok: true, request } : { ok: false, errors: errorsByField(result.errors) };
}

/** The new club CREATE sends. */
export function checkNewClub(draft: ClubDraft): DraftCheck {
  const request = { name: draft.name, tag: draft.tag.trim(), ...settingsRequest(draft) };
  const result = validateNewClub(request);
  return result.ok ? { ok: true, request } : { ok: false, errors: errorsByField(result.errors) };
}

export interface Rebased {
  readonly draft: ClubDraft;
  /** Lines changed here and, to something else, by another officer meanwhile. */
  readonly conflicts: ReadonlySet<ClubField>;
}

function withFieldOf(target: ClubDraft, source: ClubDraft, field: ClubField): ClubDraft {
  switch (field) {
    case "name":
      return { ...target, name: source.name };
    case "tag":
      return { ...target, tag: source.tag };
    case "status":
      return { ...target, isOpen: source.isOpen };
    case "regions":
      return { ...target, regions: source.regions };
    case "codes":
      return { ...target, codes: source.codes };
    case "uniforms":
      return { ...target, firstUniform: source.firstUniform, secondUniform: source.secondUniform };
    case "stadium":
      return { ...target, stadium: source.stadium };
    case "discord":
      return { ...target, discordUrl: source.discordUrl };
  }
}

/**
 * The draft laid on top of settings another officer saved meanwhile: a line changed here keeps its value (a
 * conflict when it was changed there too, to something else), every other line takes the new value.
 */
export function rebaseDraft(draft: ClubDraft, before: ClubSettingsValue, now: ClubSettingsValue): Rebased {
  const mine = changedFields(draft, before);
  const current = createDraft(now);
  const theirs = changedFields(current, before);
  let next = current;
  const conflicts = new Set<ClubField>();
  for (const field of mine) {
    next = withFieldOf(next, draft, field);
    if (theirs.has(field) && !sameField(draft, current, field)) conflicts.add(field);
  }
  return { draft: next, conflicts };
}
