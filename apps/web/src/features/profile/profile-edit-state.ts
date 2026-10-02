// The profile page's editing as data, without DOM: the draft (title, country, Switch code and MSC codes as
// the member has changed them so far), which of its fields differ from what is saved, the whole profile one
// SAVE sends, the errors of each field, and what is left of the draft when the profile was changed
// elsewhere (in Discord) meanwhile.

import {
  FIELD_ERROR_MESSAGES,
  MAX_MSC_CODES,
  friendCodeBlocks,
  friendCodeFromBlocks,
  validateEditableProfile,
  type EditableProfileInput,
  type FieldError,
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
  /** The selected title's code, "" for none. */
  readonly title: string;
  /** The titles the member can select, in the order of the list. */
  readonly titles: readonly TitleOption[];
}

/** A player title the member can select (GET /api/profile/me/editable). */
export interface TitleOption {
  readonly code: string;
  /** FULL CAPS. */
  readonly name: string;
  readonly category: string;
  readonly category_name: string;
  readonly style: string;
  /** Its game ("MSBL", "MSC", "SMS"), shown as the game's ball; "" for none (older answers lack it). */
  readonly game_code?: string;
}

/** What is saved of a profile; the base a draft is compared with. */
export type SavedProfile = Pick<EditableProfile, "country" | "switch_code" | "msc_codes" | "title">;

export type Blocks = readonly [string, string, string];

export const EMPTY_BLOCKS: Blocks = ["", "", ""];

/** An MSC code of the draft; `original` is the saved code it stands for, null for a new one. */
export interface DraftMsc {
  readonly key: string;
  readonly original: string | null;
  readonly region: string;
  readonly platform: string;
  readonly blocks: Blocks;
}

export interface Draft {
  /** A title code, "" for none. */
  readonly title: string;
  readonly country: string;
  readonly switchBlocks: Blocks;
  readonly msc: readonly DraftMsc[];
}

/** Field keys: "title", "country", "switch", "msc" (the list) and "msc:<row key>". */
export const TITLE_FIELD = "title";
export const COUNTRY_FIELD = "country";
export const SWITCH_FIELD = "switch";
export const MSC_LIST_FIELD = "msc";

export function mscField(row: Pick<DraftMsc, "key">): string {
  return `msc:${row.key}`;
}

/** The draft of a saved profile: nothing changed yet. */
export function createDraft(saved: SavedProfile): Draft {
  return {
    title: saved.title,
    country: saved.country,
    switchBlocks: friendCodeBlocks(saved.switch_code),
    msc: saved.msc_codes.map((entry) => ({
      key: `saved:${entry.code}`,
      original: entry.code,
      region: entry.region,
      platform: entry.platform,
      blocks: friendCodeBlocks(entry.code),
    })),
  };
}

/** An empty MSC code to add, with a key no other row of the draft has. */
export function newMscRow(draft: Draft): DraftMsc {
  let index = 1;
  while (draft.msc.some((row) => row.key === `new:${String(index)}`)) index += 1;
  return { key: `new:${String(index)}`, original: null, region: "", platform: "", blocks: EMPTY_BLOCKS };
}

function blocksText(blocks: Blocks): string {
  return blocks.join("");
}

function codeOf(blocks: Blocks): string {
  const entry = friendCodeFromBlocks(blocks);
  return entry.kind === "complete" ? entry.code : "";
}

/** A row added with "+" that has nothing in it yet: it changes nothing and is not sent. */
export function isBlankNewRow(row: DraftMsc): boolean {
  return row.original === null && !row.region && !row.platform && !blocksText(row.blocks);
}

function savedRowOf(saved: SavedProfile, row: DraftMsc): MscCodeInput | undefined {
  return row.original === null ? undefined : saved.msc_codes.find((entry) => entry.code === row.original);
}

function rowChanged(saved: SavedProfile, row: DraftMsc): boolean {
  const stored = savedRowOf(saved, row);
  if (!stored) return !isBlankNewRow(row);
  return (
    row.region !== stored.region ||
    row.platform !== stored.platform ||
    blocksText(row.blocks) !== blocksText(friendCodeBlocks(stored.code))
  );
}

/** The fields whose draft differs from what is saved ("msc" when a saved code was removed). */
export function changedFields(draft: Draft, saved: SavedProfile): Set<string> {
  const fields = new Set<string>();
  if (draft.title !== saved.title) fields.add(TITLE_FIELD);
  if (draft.country !== saved.country) fields.add(COUNTRY_FIELD);
  if (blocksText(draft.switchBlocks) !== blocksText(friendCodeBlocks(saved.switch_code))) fields.add(SWITCH_FIELD);
  for (const row of draft.msc) if (rowChanged(saved, row)) fields.add(mscField(row));
  const kept = new Set(draft.msc.map((row) => row.original));
  if (saved.msc_codes.some((entry) => !kept.has(entry.code))) fields.add(MSC_LIST_FIELD);
  return fields;
}

export function isDirty(draft: Draft, saved: SavedProfile): boolean {
  return changedFields(draft, saved).size > 0;
}

/** Whether "+" can add another MSC code to the draft. */
export function canAddMscCode(draft: Draft): boolean {
  return draft.msc.length < MAX_MSC_CODES;
}

export interface DraftRequest {
  /** The whole profile as PUT /api/profile/me/editable takes it (without version). */
  readonly request: EditableProfileInput;
  /** The draft row of each msc_codes entry, to place the API's errors ("msc_codes.<index>.code"). */
  readonly rowKeys: readonly string[];
}

export function draftRequest(draft: Draft): DraftRequest {
  const rows = draft.msc.filter((row) => !isBlankNewRow(row));
  return {
    request: {
      title: draft.title,
      country: draft.country,
      switch_code: codeOf(draft.switchBlocks),
      msc_codes: rows.map((row) => ({ region: row.region, platform: row.platform, code: codeOf(row.blocks) })),
    },
    rowKeys: rows.map((row) => row.key),
  };
}

/** The field an API error is about: "title", "country", "switch", "msc:<row key>" or the list ("msc"). */
export function fieldOfError(path: string, rowKeys: readonly string[]): string {
  if (path === "title") return TITLE_FIELD;
  if (path === "country") return COUNTRY_FIELD;
  if (path === "switch_code") return SWITCH_FIELD;
  const match = /^msc_codes\.(\d+)(?:\.|$)/.exec(path);
  const key = match ? rowKeys[Number(match[1])] : undefined;
  return key ? `msc:${key}` : MSC_LIST_FIELD;
}

/** Messages per field. */
export type FieldErrors = ReadonlyMap<string, readonly string[]>;

/** The API's (or the shared rules') errors, placed at their fields. */
export function errorsByField(errors: readonly FieldError[], rowKeys: readonly string[]): FieldErrors {
  const byField = new Map<string, string[]>();
  for (const error of errors) {
    const field = fieldOfError(error.field, rowKeys);
    const messages = byField.get(field) ?? [];
    if (!messages.includes(error.message)) messages.push(error.message);
    byField.set(field, messages);
  }
  return byField;
}

export type DraftCheck =
  | { readonly ok: true; readonly request: EditableProfileInput; readonly rowKeys: readonly string[] }
  | { readonly ok: false; readonly errors: FieldErrors; readonly rowKeys: readonly string[] };

/** The draft checked with the rules the API applies, before anything is sent. */
export function checkDraft(
  draft: Draft,
  saved: SavedProfile,
  countries: EditableProfile["countries"],
  titles: EditableProfile["titles"],
): DraftCheck {
  const { request, rowKeys } = draftRequest(draft);
  const errors = new Map<string, string[]>();
  const add = (field: string, message: string): void => {
    const messages = errors.get(field) ?? [];
    if (!messages.includes(message)) messages.push(message);
    errors.set(field, messages);
  };
  // Typed digits that are no whole code; the shared rules would only see an empty code.
  if (friendCodeFromBlocks(draft.switchBlocks).kind === "incomplete")
    add(SWITCH_FIELD, FIELD_ERROR_MESSAGES.INCOMPLETE);
  for (const row of draft.msc) {
    if (isBlankNewRow(row)) continue;
    // A saved code is removed with "−", so its line needs all 12 digits.
    if (friendCodeFromBlocks(row.blocks).kind !== "complete") add(mscField(row), FIELD_ERROR_MESSAGES.INCOMPLETE);
  }
  const stored = new Map(saved.msc_codes.map((entry) => [`${entry.region}:${entry.code}`, entry.platform]));
  const checked = validateEditableProfile(request, {
    isAllowedCountry: (code) => code === saved.country || countries.some((country) => country.code === code),
    storedPlatform: (region, code) => stored.get(`${region}:${code}`) ?? null,
    isAvailableTitle: (code) => titles.some((title) => title.code === code),
  });
  if (!checked.ok) {
    for (const error of checked.errors) {
      const field = fieldOfError(error.field, rowKeys);
      // The missing digits are already reported in the form's own words.
      if (error.code === "INCOMPLETE" && errors.has(field)) continue;
      add(field, error.message);
    }
  }
  if (errors.size || !checked.ok) return { ok: false, errors, rowKeys };
  return { ok: true, request: checked.value, rowKeys };
}

export interface Rebased {
  readonly draft: Draft;
  /** Why the draft changed, in words, when it did. */
  readonly notes: readonly string[];
  /** Fields both the member and someone elsewhere changed: the member's value stays and needs a look. */
  readonly conflicts: ReadonlySet<string>;
}

/**
 * The draft on top of the profile as it is saved now (after a 409, or a draft kept over a login): what the
 * member did not touch follows the newly saved profile, what they changed stays. A changed MSC code that
 * was removed elsewhere becomes a new code; codes added elsewhere join the list.
 */
export function rebaseDraft(
  draft: Draft,
  base: SavedProfile,
  current: SavedProfile,
  describeCountry: (code: string) => string,
  describeTitle: (code: string) => string = (code) => code,
): Rebased {
  const notes: string[] = [];
  const conflicts = new Set<string>();
  const baseDraft = createDraft(base);
  const currentDraft = createDraft(current);

  let title = current.title;
  if (draft.title !== base.title) {
    title = draft.title;
    if (current.title !== base.title && current.title !== draft.title) {
      conflicts.add(TITLE_FIELD);
      notes.push(`Title saved now: ${current.title ? describeTitle(current.title) : "no title"}.`);
    }
  }

  let country = current.country;
  if (draft.country !== base.country) {
    country = draft.country;
    if (current.country !== base.country && current.country !== draft.country) {
      conflicts.add(COUNTRY_FIELD);
      notes.push(`Country saved now: ${current.country ? describeCountry(current.country) : "no country"}.`);
    }
  }

  let switchBlocks = currentDraft.switchBlocks;
  if (blocksText(draft.switchBlocks) !== blocksText(baseDraft.switchBlocks)) {
    switchBlocks = draft.switchBlocks;
    if (current.switch_code !== base.switch_code && codeOf(draft.switchBlocks) !== current.switch_code) {
      conflicts.add(SWITCH_FIELD);
      notes.push(`Switch code saved now: ${current.switch_code ? `SW-${current.switch_code}` : "no code"}.`);
    }
  }

  const rows: DraftMsc[] = [];
  const inDraft = new Set<string>();
  for (const row of draft.msc) {
    if (row.original === null) {
      rows.push(row);
      continue;
    }
    inDraft.add(row.original);
    const now = currentDraft.msc.find((entry) => entry.original === row.original);
    if (!rowChanged(base, row)) {
      // Untouched: as it is saved now, or gone when it was removed elsewhere.
      if (now) rows.push(now);
      continue;
    }
    if (now) {
      rows.push(row);
      if (rowChanged(base, now)) {
        conflicts.add(mscField(row));
        notes.push(`MSC code ${row.original} was also changed elsewhere.`);
      }
    } else {
      rows.push({ ...row, key: `new:moved:${row.original}`, original: null });
      conflicts.add(`msc:new:moved:${row.original}`);
      notes.push(`MSC code ${row.original} was removed elsewhere; saving adds yours as a new code.`);
    }
  }
  // Removed in the draft stays removed; added elsewhere joins the list.
  const removedHere = new Set(base.msc_codes.map((entry) => entry.code).filter((code) => !inDraft.has(code)));
  for (const entry of currentDraft.msc) {
    if (entry.original !== null && !inDraft.has(entry.original) && !removedHere.has(entry.original)) {
      rows.splice(rows.filter((row) => row.original !== null).length, 0, entry);
      notes.push(`MSC code ${entry.original} was added elsewhere.`);
    }
  }
  return { draft: { title, country, switchBlocks, msc: rows }, notes, conflicts };
}

/** The draft as sessionStorage keeps it over an expired login. */
export interface StoredDraft {
  readonly v: 3;
  readonly id: string;
  readonly base: SavedProfile;
  readonly draft: Draft;
}

function isBlocks(value: unknown): value is Blocks {
  return Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === "string");
}

function isMscInput(value: unknown): value is MscCodeInput {
  const entry = value as Partial<MscCodeInput> | null;
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof entry.region === "string" &&
    typeof entry.platform === "string" &&
    typeof entry.code === "string"
  );
}

/**
 * A stored draft of this member, or null for anything else. A draft from before titles (v2) has none: it
 * leaves the title as it is saved.
 */
export function parseStoredDraft(raw: string | null, discordId: string): StoredDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as (Partial<Omit<StoredDraft, "v">> & { readonly v?: unknown }) | null;
    if ((value?.v !== 2 && value?.v !== 3) || value.id !== discordId) return null;
    const { base, draft } = value;
    if (!base || typeof base.country !== "string" || typeof base.switch_code !== "string") return null;
    if (!Array.isArray(base.msc_codes) || !base.msc_codes.every(isMscInput)) return null;
    if (!draft || typeof draft.country !== "string" || !isBlocks(draft.switchBlocks) || !Array.isArray(draft.msc)) {
      return null;
    }
    const withTitle = value.v === 3;
    if (withTitle && (typeof base.title !== "string" || typeof draft.title !== "string")) return null;
    const rows = draft.msc as unknown[];
    const valid = rows.every((row) => {
      const entry = row as Partial<DraftMsc> | null;
      return (
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.key === "string" &&
        (entry.original === null || typeof entry.original === "string") &&
        typeof entry.region === "string" &&
        typeof entry.platform === "string" &&
        isBlocks(entry.blocks)
      );
    });
    if (!valid) return null;
    return withTitle
      ? { v: 3, id: discordId, base, draft }
      : { v: 3, id: discordId, base: { ...base, title: "" }, draft: { ...draft, title: "" } };
  } catch {
    return null;
  }
}
