// The profile editor's form as data, without DOM: from and to the API, whether it has unsaved changes,
// and how a newer saved profile (changed in Discord meanwhile) is merged into it.

import {
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
}

export type Blocks = readonly [string, string, string];

export interface MscRow {
  readonly region: string;
  readonly platform: string;
  readonly blocks: Blocks;
}

export interface FormState {
  readonly country: string;
  readonly switchBlocks: Blocks;
  readonly msc: readonly [MscRow, MscRow, MscRow];
}

export const EMPTY_BLOCKS: Blocks = ["", "", ""];
export const EMPTY_ROW: MscRow = { region: "", platform: "", blocks: EMPTY_BLOCKS };

export function fromEditable(profile: Pick<EditableProfile, "country" | "switch_code" | "msc_codes">): FormState {
  const rows = profile.msc_codes
    .slice(0, 3)
    .map((entry): MscRow => ({ region: entry.region, platform: entry.platform, blocks: friendCodeBlocks(entry.code) }));
  while (rows.length < 3) rows.push(EMPTY_ROW);
  return {
    country: profile.country,
    switchBlocks: friendCodeBlocks(profile.switch_code),
    msc: [rows[0] ?? EMPTY_ROW, rows[1] ?? EMPTY_ROW, rows[2] ?? EMPTY_ROW],
  };
}

/** A row counts once a digit is in it; region and platform alone are no code. */
function hasDigits(blocks: Blocks): boolean {
  return blocks.some((block) => block !== "");
}

export type RequestResult =
  | { readonly ok: true; readonly request: EditableProfileInput }
  | { readonly ok: false; readonly errors: readonly FieldError[] };

/**
 * The PUT body of the form, checked with the rules the API enforces. Errors name form fields:
 * "country", "switch_code", "msc.<row>.<region|platform|code>", "msc".
 */
export function toRequest(state: FormState, profile: Pick<EditableProfile, "countries" | "msc_codes">): RequestResult {
  const errors: FieldError[] = [];
  const switchEntry = friendCodeFromBlocks(state.switchBlocks);
  if (switchEntry.kind === "incomplete") errors.push(incompleteError("switch_code"));

  const rows: number[] = [];
  const mscCodes: MscCodeInput[] = [];
  state.msc.forEach((row, index) => {
    if (!hasDigits(row.blocks)) return;
    const entry = friendCodeFromBlocks(row.blocks);
    if (entry.kind === "incomplete") errors.push(incompleteError(`msc.${index}.code`));
    rows.push(index);
    mscCodes.push({ region: row.region, platform: row.platform, code: entry.kind === "complete" ? entry.code : "" });
  });

  const request: EditableProfileInput = {
    country: state.country,
    switch_code: switchEntry.kind === "complete" ? switchEntry.code : "",
    msc_codes: mscCodes,
  };
  const allowed = new Set(profile.countries.map((country) => country.code));
  const legacy = new Set(profile.msc_codes.map((entry) => `${entry.region}:${entry.code}`));
  const checked = validateEditableProfile(request, {
    isAllowedCountry: (code) => allowed.has(code),
    isKeptLegacyCode: (region, code) => legacy.has(`${region}:${code}`),
  });
  if (!checked.ok) {
    for (const error of checked.errors) {
      const field = toFormField(error.field, rows);
      // An incomplete code is already reported with the form's own wording.
      if (!errors.some((known) => known.field === field)) errors.push({ ...error, field });
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, request: checked.ok ? checked.value : request };
}

function incompleteError(field: string): FieldError {
  return {
    field,
    code: "INCOMPLETE",
    message: "Enter all 12 digits (4 in each field) or leave all three fields empty.",
  };
}

/** "msc_codes.1.platform" of the request → "msc.<form row>.platform". */
export function toFormField(field: string, rows: readonly number[]): string {
  const match = /^msc_codes\.(\d+)(\..+)?$/.exec(field);
  if (!match) return field === "msc_codes" ? "msc" : field;
  const row = rows[Number(match[1])] ?? Number(match[1]);
  return `msc.${row}${match[2] ?? ""}`;
}

/** The parts of the form a merge takes from one side or the other. */
export type Group = "country" | "switch" | "msc";
export const GROUPS: readonly Group[] = ["country", "switch", "msc"];

/** What a save would store, so selections in a row without digits do not count as a change. */
function groupValue(state: FormState, group: Group): string {
  if (group === "country") return state.country;
  if (group === "switch") return state.switchBlocks.join("");
  return JSON.stringify(
    state.msc.filter((row) => hasDigits(row.blocks)).map((row) => [row.region, row.platform, row.blocks.join("")]),
  );
}

export function changedGroups(base: FormState, current: FormState): Group[] {
  return GROUPS.filter((group) => groupValue(base, group) !== groupValue(current, group));
}

export function isDirty(base: FormState, current: FormState): boolean {
  return changedGroups(base, current).length > 0;
}

export interface MergeResult {
  readonly state: FormState;
  /** Groups only changed elsewhere: they now show the saved value. */
  readonly updated: readonly Group[];
  /** Groups changed here and elsewhere: they keep this form's value, which a new Apply saves over the other. */
  readonly contested: readonly Group[];
}

/**
 * Merges the profile saved meanwhile (`theirs`) into the form (`mine`), both changed from `base`:
 * nothing typed here is lost, and nothing saved elsewhere is replaced without the user seeing it.
 */
export function mergeChanges(base: FormState, mine: FormState, theirs: FormState): MergeResult {
  const mineChanged = new Set(changedGroups(base, mine));
  const theirsChanged = new Set(changedGroups(base, theirs));
  const pick = (group: Group): FormState => (mineChanged.has(group) ? mine : theirs);
  const state: FormState = {
    country: pick("country").country,
    switchBlocks: pick("switch").switchBlocks,
    msc: pick("msc").msc,
  };
  return {
    state,
    updated: GROUPS.filter((group) => theirsChanged.has(group) && !mineChanged.has(group)),
    contested: GROUPS.filter(
      (group) =>
        theirsChanged.has(group) && mineChanged.has(group) && groupValue(mine, group) !== groupValue(theirs, group),
    ),
  };
}
