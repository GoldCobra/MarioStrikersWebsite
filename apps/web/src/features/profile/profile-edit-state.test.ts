import assert from "node:assert/strict";
import test from "node:test";
import { spreadDigits } from "./friend-code-input.ts";
import {
  EMPTY_ROW,
  changedGroups,
  fromEditable,
  isDirty,
  mergeChanges,
  toFormField,
  toRequest,
  type EditableProfile,
  type FormState,
} from "./profile-edit-state.ts";

const PROFILE: Pick<EditableProfile, "country" | "switch_code" | "msc_codes" | "countries"> = {
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

test("the form shows the saved profile with leading zeros and three MSC rows", () => {
  const state = fromEditable(PROFILE);
  assert.deepEqual(state.switchBlocks, ["0012", "0000", "0340"]);
  assert.deepEqual(state.msc[0], { region: "PAL", platform: "Wii", blocks: ["1111", "2222", "3333"] });
  assert.deepEqual(state.msc[2], EMPTY_ROW);
});

test("an unchanged form is no change; selections in a row without digits are none either", () => {
  const base = fromEditable(PROFILE);
  assert.equal(isDirty(base, base), false);
  const selected: FormState = { ...base, msc: [base.msc[0], base.msc[1], { ...EMPTY_ROW, region: "PAL" }] };
  assert.equal(isDirty(base, selected), false);
  assert.deepEqual(changedGroups(base, { ...base, country: "us" }), ["country"]);
});

test("the request carries complete codes only, in the API's form", () => {
  const base = fromEditable(PROFILE);
  const state: FormState = {
    country: "us",
    switchBlocks: ["", "", ""],
    msc: [base.msc[0], { ...base.msc[1], platform: "Dolphin" }, { region: "", platform: "", blocks: ["", "", ""] }],
  };
  assert.deepEqual(toRequest(state, PROFILE), {
    ok: true,
    request: {
      country: "us",
      switch_code: "",
      msc_codes: [
        { region: "PAL", platform: "Wii", code: "1111-2222-3333" },
        { region: "NTSC", platform: "Dolphin", code: "4444-5555-6666" },
      ],
    },
  });
});

test("incomplete codes and missing choices name the form fields", () => {
  const base = fromEditable(PROFILE);
  const state: FormState = {
    country: "fr",
    switchBlocks: ["0012", "0000", "034"],
    msc: [EMPTY_ROW, { ...base.msc[1] }, { region: "", platform: "Wii", blocks: ["9", "", ""] }],
  };
  const result = toRequest(state, PROFILE);
  assert.ok(!result.ok);
  assert.deepEqual(result.errors.map((error) => `${error.field}:${error.code}`).sort(), [
    "country:UNKNOWN_COUNTRY",
    "msc.1.platform:PLATFORM_REQUIRED",
    "msc.2.code:INCOMPLETE",
    "msc.2.region:REGION_REQUIRED",
    "switch_code:INCOMPLETE",
  ]);
});

test("request fields map back to the form rows they came from", () => {
  assert.equal(toFormField("msc_codes.0.code", [2]), "msc.2.code");
  assert.equal(toFormField("msc_codes", [0]), "msc");
  assert.equal(toFormField("country", []), "country");
});

test("a profile changed elsewhere is merged without losing anything typed here", () => {
  const base = fromEditable(PROFILE);
  const mine: FormState = { ...base, country: "us" };
  const theirs = fromEditable({ ...PROFILE, switch_code: "9999-8888-7777" });
  const merged = mergeChanges(base, mine, theirs);
  assert.equal(merged.state.country, "us");
  assert.deepEqual(merged.state.switchBlocks, ["9999", "8888", "7777"]);
  assert.deepEqual(merged.updated, ["switch"]);
  assert.deepEqual(merged.contested, []);

  const bothChanged = mergeChanges(base, mine, fromEditable({ ...PROFILE, country: "" }));
  assert.equal(bothChanged.state.country, "us");
  assert.deepEqual(bothChanged.contested, ["country"]);
});

test("digits spread over the three fields like one text", () => {
  assert.deepEqual(spreadDigits(["12", "", ""], 0, "34"), { values: ["1234", "", ""], field: 0, caret: 4 });
  assert.deepEqual(spreadDigits(["12", "", ""], 0, "345678"), { values: ["1234", "5678", ""], field: 1, caret: 4 });
  assert.deepEqual(spreadDigits(["", "", ""], 0, "001200000340", { start: 0, end: 0 }), {
    values: ["0012", "0000", "0340"],
    field: 2,
    caret: 4,
  });
  // What follows an insertion moves along; nothing typed is lost before the last field.
  assert.deepEqual(spreadDigits(["", "5678", "9012"], 0, "12", { start: 0, end: 0 }), {
    values: ["1256", "7890", "12"],
    field: 0,
    caret: 2,
  });
  // A selection is replaced, fields before the insertion keep their digits.
  assert.deepEqual(spreadDigits(["1234", "5678", "9012"], 1, "00", { start: 1, end: 3 }), {
    values: ["1234", "5008", "9012"],
    field: 1,
    caret: 3,
  });
  assert.deepEqual(spreadDigits(["1234", "5678", ""], 2, "9012345", { start: 0, end: 0 }), {
    values: ["1234", "5678", "9012"],
    field: 2,
    caret: 4,
  });
  assert.deepEqual(spreadDigits(["", "", ""], 0, "a1b2", { start: 0, end: 0 }).values, ["12", "", ""]);
});
