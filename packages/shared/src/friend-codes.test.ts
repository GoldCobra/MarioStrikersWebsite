import assert from "node:assert/strict";
import test from "node:test";
import {
  FRIEND_CODE_PATTERN,
  formatFriendCode,
  friendCodeBlocks,
  friendCodeFromBlocks,
  pastedFriendCodeDigits,
  validateEditableProfile,
  type ValidationOptions,
} from "./friend-codes.ts";

const OPTIONS: ValidationOptions = {
  isAllowedCountry: (code) => ["de", "us", "scotland"].includes(code),
  isKeptLegacyCode: (region, code) => region === "JPN" && code === "1111-2222-3333",
};

const valid = { country: "de", switch_code: "0001-0020-0300", msc_codes: [] };

function errorsOf(input: unknown): string[] {
  const result = validateEditableProfile(input, OPTIONS);
  return result.ok ? [] : result.errors.map((error) => `${error.field}:${error.code}`);
}

test("codes keep their leading zeros from fields to storage and back", () => {
  assert.deepEqual(friendCodeFromBlocks(["0012", "0000", "0340"]), { kind: "complete", code: "0012-0000-0340" });
  assert.deepEqual(friendCodeBlocks("0012-0000-0340"), ["0012", "0000", "0340"]);
  assert.equal(formatFriendCode("000000000001"), "0000-0000-0001");
  assert.ok(FRIEND_CODE_PATTERN.test("0000-0000-0001"));
  assert.deepEqual(friendCodeBlocks("SW-1234-5678-9012"), ["", "", ""]);
});

test("three fields hold no code, a whole code or part of one", () => {
  assert.deepEqual(friendCodeFromBlocks(["", "", ""]), { kind: "empty" });
  assert.deepEqual(friendCodeFromBlocks(["1234", "5678", "901"]), { kind: "incomplete" });
  assert.deepEqual(friendCodeFromBlocks(["1", "", ""]), { kind: "incomplete" });
  assert.deepEqual(friendCodeFromBlocks(["1234", "5678", "9012"]), { kind: "complete", code: "1234-5678-9012" });
});

test("pasted codes keep only their digits, and only when nothing else is in them", () => {
  assert.equal(pastedFriendCodeDigits("SW-1234-5678-9012"), "123456789012");
  assert.equal(pastedFriendCodeDigits(" 1234 5678 9012 "), "123456789012");
  assert.equal(pastedFriendCodeDigits("0012.0000.0340"), "001200000340");
  assert.equal(pastedFriendCodeDigits("12/34"), "1234");
  assert.equal(pastedFriendCodeDigits("12a4"), null);
  assert.equal(pastedFriendCodeDigits("Code: 1234"), null);
  assert.equal(pastedFriendCodeDigits("１２３４"), null);
  assert.equal(pastedFriendCodeDigits(""), "");
});

test("a complete request passes and is normalised", () => {
  const result = validateEditableProfile(
    {
      country: " DE ",
      switch_code: "0001-0020-0300",
      msc_codes: [
        { region: "pal", platform: "Wii", code: "1234-5678-9012" },
        { region: "", platform: "", code: "" },
      ],
    },
    OPTIONS,
  );
  assert.deepEqual(result, {
    ok: true,
    value: {
      country: "de",
      switch_code: "0001-0020-0300",
      msc_codes: [{ region: "PAL", platform: "Wii", code: "1234-5678-9012" }],
    },
  });
  assert.deepEqual(errorsOf({ country: "", switch_code: "", msc_codes: [] }), []);
  assert.deepEqual(errorsOf({ country: "", switch_code: "" }), []);
});

test("incomplete and malformed codes are refused", () => {
  assert.deepEqual(errorsOf({ ...valid, switch_code: "1234-5678-901" }), ["switch_code:INCOMPLETE"]);
  assert.deepEqual(errorsOf({ ...valid, switch_code: "123456789012" }), ["switch_code:INVALID"]);
  assert.deepEqual(errorsOf({ ...valid, switch_code: "SW-1234-5678-9012" }), ["switch_code:INVALID"]);
  assert.deepEqual(errorsOf({ ...valid, switch_code: "abcd-efgh-ijkl" }), ["switch_code:INCOMPLETE"]);
  assert.deepEqual(errorsOf({ ...valid, switch_code: 123456789012 }), ["switch_code:INVALID"]);
});

test("every MSC code needs its region and platform, the bot's choices only", () => {
  const msc = (row: Record<string, unknown>): string[] => errorsOf({ ...valid, msc_codes: [row] });
  assert.deepEqual(msc({ region: "PAL", platform: "", code: "1234-5678-9012" }), [
    "msc_codes.0.platform:PLATFORM_REQUIRED",
  ]);
  assert.deepEqual(msc({ region: "", platform: "Wii", code: "1234-5678-9012" }), [
    "msc_codes.0.region:REGION_REQUIRED",
  ]);
  assert.deepEqual(msc({ region: "PAL", platform: "Wii", code: "" }), ["msc_codes.0.code:INCOMPLETE"]);
  assert.deepEqual(msc({ region: "PAL", platform: "Wii", code: "12" }), ["msc_codes.0.code:INCOMPLETE"]);
  assert.deepEqual(msc({ region: "EU", platform: "Wii", code: "1234-5678-9012" }), ["msc_codes.0.region:INVALID"]);
  assert.deepEqual(msc({ region: "PAL", platform: "Switch", code: "1234-5678-9012" }), [
    "msc_codes.0.platform:INVALID",
  ]);
  assert.deepEqual(msc({ region: "NTSC", platform: "Wii U", code: "1234-5678-9012" }), []);
  assert.deepEqual(msc({ region: "NTSC", platform: "Dolphin", code: "1234-5678-9012" }), []);
});

test("legacy NTSC-J/K codes may stay but none can be added", () => {
  const msc = (row: Record<string, unknown>): string[] => errorsOf({ ...valid, msc_codes: [row] });
  assert.deepEqual(msc({ region: "JPN", platform: "Wii", code: "1111-2222-3333" }), []);
  assert.deepEqual(msc({ region: "JPN", platform: "Wii", code: "9999-2222-3333" }), ["msc_codes.0.region:INVALID"]);
  assert.deepEqual(msc({ region: "KOR", platform: "Wii", code: "1111-2222-3333" }), ["msc_codes.0.region:INVALID"]);
});

test("at most three MSC codes, none twice; Switch and MSC may share a code", () => {
  const row = (code: string) => ({ region: "PAL", platform: "Wii", code });
  assert.deepEqual(
    errorsOf({ ...valid, msc_codes: [row("1111-1111-1111"), row("2222-2222-2222"), row("1111-1111-1111")] }),
    ["msc_codes.2.code:DUPLICATE"],
  );
  assert.deepEqual(
    errorsOf({
      ...valid,
      msc_codes: [row("1111-1111-1111"), row("2222-2222-2222"), row("3333-3333-3333"), row("4444-4444-4444")],
    }),
    ["msc_codes:TOO_MANY"],
  );
  assert.deepEqual(errorsOf({ ...valid, switch_code: "1111-1111-1111", msc_codes: [row("1111-1111-1111")] }), []);
});

test("the country is one of the list, or the profile's current one", () => {
  assert.deepEqual(errorsOf({ ...valid, country: "fr" }), ["country:UNKNOWN_COUNTRY"]);
  assert.deepEqual(errorsOf({ ...valid, country: "Scotland" }), []);
  assert.deepEqual(errorsOf({ ...valid, country: 5 }), ["country:INVALID"]);
});

test("requests that are no object are refused", () => {
  for (const input of [null, "text", [valid], 42]) assert.deepEqual(errorsOf(input), ["request:INVALID"]);
  assert.deepEqual(errorsOf({ ...valid, msc_codes: "PAL" }), ["msc_codes:INVALID"]);
  assert.deepEqual(errorsOf({ ...valid, msc_codes: ["PAL"] }), ["msc_codes.0:INVALID"]);
});
