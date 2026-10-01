import assert from "node:assert/strict";
import test from "node:test";
import {
  canAddMscCode,
  checkEdit,
  isChanged,
  rebaseEdit,
  requestFor,
  savedText,
  startEdit,
  type EditableProfile,
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

test("an edit starts from what is saved", () => {
  assert.deepEqual(startEdit(PROFILE, { kind: "country" }), { kind: "country", country: "de" });
  assert.deepEqual(startEdit(PROFILE, { kind: "switch" }), { kind: "switch", blocks: ["0012", "0000", "0340"] });
  assert.deepEqual(startEdit(PROFILE, { kind: "msc", code: "4444-5555-6666" }), {
    kind: "msc",
    original: "4444-5555-6666",
    region: "NTSC",
    platform: "",
    blocks: ["4444", "5555", "6666"],
  });
  assert.deepEqual(startEdit(PROFILE, { kind: "msc", code: null }), {
    kind: "msc",
    original: null,
    region: "",
    platform: "",
    blocks: ["", "", ""],
  });
});

test("the request is the saved profile with the one change", () => {
  assert.deepEqual(requestFor(PROFILE, { kind: "country", country: "us" }), {
    country: "us",
    switch_code: "0012-0000-0340",
    msc_codes: PROFILE.msc_codes,
  });
  assert.equal(requestFor(PROFILE, { kind: "switch", blocks: ["", "", ""] }).switch_code, "");
  assert.deepEqual(
    requestFor(PROFILE, {
      kind: "msc",
      original: "1111-2222-3333",
      region: "PAL",
      platform: "Dolphin",
      blocks: ["0001", "0002", "0003"],
    }).msc_codes,
    [
      { region: "PAL", platform: "Dolphin", code: "0001-0002-0003" },
      { region: "NTSC", platform: "", code: "4444-5555-6666" },
    ],
  );
  assert.equal(
    requestFor(PROFILE, {
      kind: "msc",
      original: null,
      region: "PAL",
      platform: "Wii",
      blocks: ["7777", "8888", "9999"],
    }).msc_codes.length,
    3,
  );
  assert.deepEqual(requestFor(PROFILE, { kind: "msc-delete", code: "1111-2222-3333" }).msc_codes, [
    { region: "NTSC", platform: "", code: "4444-5555-6666" },
  ]);
});

test("a change is checked like the API checks it; an older code may keep its missing platform", () => {
  const errors = (edit: Parameters<typeof checkEdit>[1]): readonly string[] => {
    const result = checkEdit(PROFILE, edit);
    return result.ok ? [] : result.errors;
  };
  assert.deepEqual(errors({ kind: "country", country: "us" }), []);
  assert.deepEqual(errors({ kind: "country", country: "fr" }), ["Select a country from the list."]);
  assert.deepEqual(errors({ kind: "switch", blocks: ["12", "", ""] }), [
    "Enter all 12 digits (4 in each field) or leave all three fields empty.",
  ]);
  assert.deepEqual(errors({ kind: "switch", blocks: ["", "", ""] }), []);
  assert.deepEqual(
    errors({ kind: "msc", original: null, region: "PAL", platform: "", blocks: ["7777", "8888", "9999"] }),
    ["Select the platform."],
  );
  assert.deepEqual(errors({ kind: "msc", original: null, region: "PAL", platform: "Wii", blocks: ["", "", ""] }), [
    "Enter all 12 digits (4 in each field) or leave all three fields empty.",
  ]);
  assert.deepEqual(
    errors({ kind: "msc", original: null, region: "PAL", platform: "Wii", blocks: ["1111", "2222", "3333"] }),
    ["This friend code is entered twice."],
  );
  // Changing the country keeps the older NTSC code without a platform as it is.
  const saved = checkEdit(PROFILE, { kind: "country", country: "us" });
  assert.ok(saved.ok);
  assert.deepEqual(saved.request.msc_codes[1], { region: "NTSC", platform: "", code: "4444-5555-6666" });
  // Changing that code itself needs its platform.
  assert.deepEqual(
    errors({ kind: "msc", original: "4444-5555-6666", region: "PAL", platform: "", blocks: ["4444", "5555", "6666"] }),
    ["Select the platform."],
  );
});

test("an edit counts as changed once it differs from what is saved", () => {
  assert.equal(isChanged(PROFILE, { kind: "country", country: "de" }), false);
  assert.equal(isChanged(PROFILE, { kind: "country", country: "us" }), true);
  assert.equal(isChanged(PROFILE, { kind: "switch", blocks: ["0012", "0000", "0340"] }), false);
  assert.equal(isChanged(PROFILE, { kind: "switch", blocks: ["0012", "0000", "034"] }), true);
  assert.equal(
    isChanged(PROFILE, { kind: "msc", original: null, region: "", platform: "", blocks: ["", "", ""] }),
    false,
  );
  assert.equal(
    isChanged(PROFILE, { kind: "msc", original: null, region: "PAL", platform: "", blocks: ["", "", ""] }),
    true,
  );
  assert.equal(
    isChanged(PROFILE, {
      kind: "msc",
      original: "4444-5555-6666",
      region: "NTSC",
      platform: "Wii",
      blocks: ["4444", "5555", "6666"],
    }),
    true,
  );
  assert.equal(isChanged(PROFILE, { kind: "msc-delete", code: "1111-2222-3333" }), false);
});

test("at most three MSC codes can be saved", () => {
  assert.equal(canAddMscCode(PROFILE), true);
  const full = {
    ...PROFILE,
    msc_codes: [...PROFILE.msc_codes, { region: "PAL", platform: "Wii", code: "7777-8888-9999" }],
  };
  assert.equal(canAddMscCode(full), false);
});

test("the saved value of an edit in words", () => {
  const name = (code: string): string => (code === "de" ? "Germany" : code);
  assert.equal(savedText(PROFILE, { kind: "country", country: "us" }, name), "Germany");
  assert.equal(savedText({ ...PROFILE, country: "" }, { kind: "country", country: "us" }, name), "no country");
  assert.equal(savedText(PROFILE, { kind: "switch", blocks: ["", "", ""] }, name), "SW-0012-0000-0340");
  assert.equal(savedText(PROFILE, { kind: "msc-delete", code: "4444-5555-6666" }, name), "NTSC: 4444-5555-6666");
  assert.equal(
    savedText(
      PROFILE,
      { kind: "msc", original: "1111-2222-3333", region: "", platform: "", blocks: ["", "", ""] },
      name,
    ),
    "PAL (Wii): 1111-2222-3333",
  );
});

test("after a change elsewhere, what is left of the open edit", () => {
  const change = {
    kind: "msc",
    original: "1111-2222-3333",
    region: "PAL",
    platform: "Dolphin",
    blocks: ["1111", "2222", "3333"],
  } as const;
  const gone = { ...PROFILE, msc_codes: PROFILE.msc_codes.slice(1) };
  assert.deepEqual(rebaseEdit(change, PROFILE), { edit: change, note: "" });
  assert.deepEqual(rebaseEdit(change, gone), {
    edit: { ...change, original: null },
    note: "This code was removed elsewhere; saving adds yours as a new code.",
  });
  assert.deepEqual(rebaseEdit({ kind: "msc-delete", code: "1111-2222-3333" }, gone), {
    edit: null,
    note: "This code was already deleted elsewhere.",
  });
  const full = {
    ...PROFILE,
    msc_codes: [
      { region: "NTSC", platform: "", code: "4444-5555-6666" },
      { region: "PAL", platform: "Wii", code: "7777-8888-9999" },
      { region: "PAL", platform: "Wii", code: "0000-0000-0001" },
    ],
  };
  assert.equal(rebaseEdit(change, full).edit, null);
  assert.equal(rebaseEdit({ ...change, original: null }, full).edit, null);
});
