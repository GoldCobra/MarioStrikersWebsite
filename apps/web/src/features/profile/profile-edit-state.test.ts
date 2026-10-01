import assert from "node:assert/strict";
import test from "node:test";
import {
  canAddMscCode,
  changedFields,
  checkDraft,
  createDraft,
  draftRequest,
  errorsByField,
  fieldOfError,
  isDirty,
  newMscRow,
  parseStoredDraft,
  rebaseDraft,
  type Draft,
  type EditableProfile,
  type SavedProfile,
} from "./profile-edit-state.ts";

const PROFILE: EditableProfile = {
  player_id: 1,
  version: "v1",
  discord: {
    id: "900000000000000001",
    server_name: "Sample",
    username: "sample",
    global_name: "",
    nick: "",
    membership: "member",
    source: "live",
  },
  country: "de",
  switch_code: "0012-0000-0340",
  msc_codes: [
    { region: "PAL", platform: "Wii", code: "1111-2222-3333" },
    { region: "NTSC", platform: "", code: "4444-5555-6666" },
  ],
  countries: [
    { code: "de", name: "Germany" },
    { code: "us", name: "United States" },
  ],
};

const SAVED: SavedProfile = PROFILE;
const name = (code: string): string => code.toUpperCase();

function withNewCode(draft: Draft, region: string, platform: string, code: string): Draft {
  const row = newMscRow(draft);
  return {
    ...draft,
    msc: [...draft.msc, { ...row, region, platform, blocks: code.split("-") as [string, string, string] }],
  };
}

test("a new draft is the saved profile and changes nothing", () => {
  const draft = createDraft(SAVED);
  assert.equal(draft.country, "de");
  assert.deepEqual(draft.switchBlocks, ["0012", "0000", "0340"]);
  assert.deepEqual(
    draft.msc.map((row) => [row.key, row.original, row.region, row.platform]),
    [
      ["saved:1111-2222-3333", "1111-2222-3333", "PAL", "Wii"],
      ["saved:4444-5555-6666", "4444-5555-6666", "NTSC", ""],
    ],
  );
  assert.equal(isDirty(draft, SAVED), false);
  assert.deepEqual(draftRequest(draft).request, {
    country: "de",
    switch_code: "0012-0000-0340",
    msc_codes: SAVED.msc_codes,
  });
});

test("several changes are kept together and sent in one request", () => {
  let draft = createDraft(SAVED);
  draft = { ...draft, country: "us", switchBlocks: ["9999", "8888", "7777"] };
  draft = { ...draft, msc: draft.msc.filter((row) => row.original !== "4444-5555-6666") };
  draft = withNewCode(draft, "PAL", "Dolphin", "0001-0002-0003");
  const fields = changedFields(draft, SAVED);
  assert.deepEqual([...fields].sort(), ["country", "msc", "msc:new:1", "switch"]);
  const { request, rowKeys } = draftRequest(draft);
  assert.deepEqual(request, {
    country: "us",
    switch_code: "9999-8888-7777",
    msc_codes: [
      { region: "PAL", platform: "Wii", code: "1111-2222-3333" },
      { region: "PAL", platform: "Dolphin", code: "0001-0002-0003" },
    ],
  });
  assert.deepEqual(rowKeys, ["saved:1111-2222-3333", "new:1"]);
  const checked = checkDraft(draft, SAVED, PROFILE.countries);
  assert.equal(checked.ok, true);
});

test("a row added with + and left empty changes nothing and is not sent", () => {
  const draft = { ...createDraft(SAVED), msc: [...createDraft(SAVED).msc, newMscRow(createDraft(SAVED))] };
  assert.equal(isDirty(draft, SAVED), false);
  assert.equal(draftRequest(draft).request.msc_codes.length, 2);
  assert.equal(checkDraft(draft, SAVED, PROFILE.countries).ok, true);
});

test("errors are placed at their fields", () => {
  let draft = createDraft(SAVED);
  draft = { ...draft, country: "xx", switchBlocks: ["12", "", ""] };
  draft = withNewCode(draft, "", "", "1234-5678-9012");
  const checked = checkDraft(draft, SAVED, PROFILE.countries);
  assert.equal(checked.ok, false);
  assert.deepEqual(checked.errors.get("country"), ["Select a country from the list."]);
  assert.deepEqual(checked.errors.get("switch"), ["Enter all 12 digits (4 in each field)."]);
  assert.deepEqual(checked.errors.get("msc:new:1"), ["Select the MSC region.", "Select the platform."]);
  // The older code saved without a platform may stay as it is.
  assert.equal(checked.errors.has("msc:saved:4444-5555-6666"), false);
});

test("a saved code changed or emptied needs its platform and all digits", () => {
  const draft = createDraft(SAVED);
  const changed: Draft = {
    ...draft,
    msc: draft.msc.map((row) =>
      row.original === "4444-5555-6666"
        ? { ...row, blocks: ["4444", "5555", "6667"] }
        : row.original
          ? { ...row, blocks: ["", "", ""] }
          : row,
    ),
  };
  const checked = checkDraft(changed, SAVED, PROFILE.countries);
  assert.equal(checked.ok, false);
  assert.deepEqual(checked.errors.get("msc:saved:4444-5555-6666"), ["Select the platform."]);
  assert.deepEqual(checked.errors.get("msc:saved:1111-2222-3333"), ["Enter all 12 digits (4 in each field)."]);
});

test("the same code twice and a fourth MSC code are refused", () => {
  let draft = withNewCode(createDraft(SAVED), "PAL", "Wii", "1111-2222-3333");
  let checked = checkDraft(draft, SAVED, PROFILE.countries);
  assert.equal(checked.ok, false);
  assert.deepEqual(checked.errors.get("msc:new:1"), ["This friend code is entered twice."]);
  draft = withNewCode(createDraft(SAVED), "PAL", "Wii", "0000-0000-0001");
  assert.equal(canAddMscCode(draft), false);
  draft = withNewCode(draft, "PAL", "Wii", "0000-0000-0002");
  checked = checkDraft(draft, SAVED, PROFILE.countries);
  assert.equal(checked.ok, false);
  assert.deepEqual(checked.errors.get("msc"), ["At most 3 MSC friend codes can be saved."]);
});

test("API errors map to the draft's rows", () => {
  const keys = ["saved:1111-2222-3333", "new:1"];
  assert.equal(fieldOfError("country", keys), "country");
  assert.equal(fieldOfError("switch_code", keys), "switch");
  assert.equal(fieldOfError("msc_codes.1.code", keys), "msc:new:1");
  assert.equal(fieldOfError("msc_codes", keys), "msc");
  assert.equal(fieldOfError("msc_codes.7.code", keys), "msc");
  const errors = errorsByField(
    [
      { field: "msc_codes.1.code", code: "TAKEN", message: "Taken." },
      { field: "msc_codes.1.code", code: "TAKEN", message: "Taken." },
    ],
    keys,
  );
  assert.deepEqual([...errors], [["msc:new:1", ["Taken."]]]);
});

test("a legacy NTSC-J code may stay, but no new code gets that region", () => {
  const saved: SavedProfile = { ...SAVED, msc_codes: [{ region: "JPN", platform: "", code: "2222-3333-4444" }] };
  assert.equal(checkDraft({ ...createDraft(saved), country: "us" }, saved, PROFILE.countries).ok, true);
  const draft = withNewCode(createDraft(saved), "JPN", "Wii", "5555-6666-7777");
  const checked = checkDraft(draft, saved, PROFILE.countries);
  assert.equal(checked.ok, false);
  assert.deepEqual(checked.errors.get("msc:new:1"), ["This value is not valid."]);
});

test("after a change elsewhere, untouched fields follow it and changed ones stay", () => {
  let draft = createDraft(SAVED);
  draft = { ...draft, switchBlocks: ["9999", "8888", "7777"] };
  const current: SavedProfile = {
    country: "us",
    switch_code: "0012-0000-0340",
    msc_codes: [
      { region: "PAL", platform: "Dolphin", code: "1111-2222-3333" },
      { region: "NTSC", platform: "Wii", code: "4444-5555-6666" },
      { region: "PAL", platform: "Wii", code: "7777-7777-7777" },
    ],
  };
  const rebased = rebaseDraft(draft, SAVED, current, name);
  assert.equal(rebased.draft.country, "us");
  assert.deepEqual(rebased.draft.switchBlocks, ["9999", "8888", "7777"]);
  assert.deepEqual(
    rebased.draft.msc.map((row) => [row.original, row.platform]),
    [
      ["1111-2222-3333", "Dolphin"],
      ["4444-5555-6666", "Wii"],
      ["7777-7777-7777", "Wii"],
    ],
  );
  assert.equal(rebased.conflicts.size, 0);
  assert.deepEqual(rebased.notes, ["MSC code 7777-7777-7777 was added elsewhere."]);
  assert.deepEqual([...changedFields(rebased.draft, current)], ["switch"]);
});

test("a change of a field changed elsewhere too is a conflict, a removed code comes back as new", () => {
  let draft = createDraft(SAVED);
  draft = {
    ...draft,
    country: "us",
    msc: draft.msc.map((row) => (row.original === "4444-5555-6666" ? { ...row, platform: "Wii U" } : row)),
  };
  const current: SavedProfile = {
    country: "fr",
    switch_code: "0012-0000-0340",
    msc_codes: [{ region: "PAL", platform: "Wii", code: "1111-2222-3333" }],
  };
  const rebased = rebaseDraft(draft, SAVED, current, name);
  assert.equal(rebased.draft.country, "us");
  assert.deepEqual([...rebased.conflicts].sort(), ["country", "msc:new:moved:4444-5555-6666"]);
  const moved = rebased.draft.msc.find((row) => row.key === "new:moved:4444-5555-6666");
  assert.ok(moved);
  assert.equal(moved.original, null);
  assert.equal(moved.platform, "Wii U");
  assert.ok(rebased.notes.includes("Country saved now: FR."));
});

test("a removed code stays removed when it is still saved", () => {
  const draft = { ...createDraft(SAVED), msc: createDraft(SAVED).msc.slice(0, 1) };
  const rebased = rebaseDraft(draft, SAVED, { ...SAVED, country: "us" }, name);
  assert.deepEqual(
    rebased.draft.msc.map((row) => row.original),
    ["1111-2222-3333"],
  );
  assert.equal(rebased.draft.country, "us");
});

test("a stored draft is used only in its own format and for the same member", () => {
  const stored = JSON.stringify({ v: 2, id: PROFILE.discord.id, base: SAVED, draft: createDraft(SAVED) });
  assert.ok(parseStoredDraft(stored, PROFILE.discord.id));
  assert.equal(parseStoredDraft(stored, "123"), null);
  assert.equal(
    parseStoredDraft(JSON.stringify({ id: PROFILE.discord.id, target: {}, edit: {} }), PROFILE.discord.id),
    null,
  );
  assert.equal(parseStoredDraft("{broken", PROFILE.discord.id), null);
  assert.equal(parseStoredDraft(null, PROFILE.discord.id), null);
});
