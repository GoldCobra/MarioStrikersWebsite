// The MSBL save core against the outputs of the former browser script, recorded in save-core.golden.json:
// every patch on the sample save and on a copy without gear must produce the same bytes.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  applyGearPreset,
  completeCupsAndUnlockBushido,
  ownAllGear,
  parseCoins,
  patchSave,
  readSave,
  setCoins,
  type GearPresetCharacter,
} from "./save-core.ts";

interface GoldenCase {
  readonly input: string;
  readonly coins: number;
  readonly read: string;
  readonly coins123456789: string;
  readonly coinsMax: string;
  readonly completeCups: string;
  readonly haveAllGear: string;
  readonly gearPreset: string;
  readonly gearPresetAllDefault: string;
}

interface Golden {
  readonly preset: readonly GearPresetCharacter[];
  readonly zeroRanges: readonly (readonly [number, number])[];
  readonly cases: { readonly sample: GoldenCase; readonly noGear: GoldenCase };
  readonly errors: Readonly<Record<"tooSmall" | "zeros" | "truncated" | "cutEntries", string>>;
}

const golden = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "save-core.golden.json"), "utf8")) as Golden;
const sample = new Uint8Array(
  fs.readFileSync(path.join(import.meta.dirname, "../../../../public/assets/savegames/100-msbl-comp/strkrs.save")),
);
const noGear = new Uint8Array(sample);
for (const [offset, length] of golden.zeroRanges) noGear.fill(0, offset, offset + length);

const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const allDefault = Array.from({ length: 16 }, (_, index) => ({ id: index + 1, name: "", build: "0000" }));

for (const [name, input] of [
  ["sample", sample],
  ["noGear", noGear],
] as const) {
  test(`the ${name} save patches exactly like the former editor`, () => {
    const expected = golden.cases[name];
    assert.equal(sha(input), expected.input);
    const read = readSave(input);
    assert.equal(read.info.coins, expected.coins);
    assert.equal(read.info.charBlockCount, 16);
    assert.equal(sha(read.bytes), expected.read);
    assert.equal(sha(patchSave(input, (context) => setCoins(context, 123_456_789)).bytes), expected.coins123456789);
    assert.equal(sha(patchSave(input, (context) => setCoins(context, 0xffffffff)).bytes), expected.coinsMax);
    assert.equal(
      sha(patchSave(input, (context) => completeCupsAndUnlockBushido(context.save)).bytes),
      expected.completeCups,
    );
    const haveAll = patchSave(input, (context) => {
      const gearChanged = ownAllGear(context);
      return completeCupsAndUnlockBushido(context.save) || gearChanged;
    });
    assert.equal(sha(haveAll.bytes), expected.haveAllGear);
    assert.equal(
      sha(patchSave(input, (context) => applyGearPreset(context, golden.preset)).bytes),
      expected.gearPreset,
    );
    assert.equal(
      sha(patchSave(input, (context) => applyGearPreset(context, allDefault)).bytes),
      expected.gearPresetAllDefault,
    );
    assert.equal(input.length, haveAll.bytes.length);
  });
}

function refusal(bytes: Uint8Array): string {
  try {
    readSave(bytes);
  } catch (error) {
    return (error as Error).message;
  }
  return assert.fail("the save was accepted");
}

test("broken saves are refused with the former messages", () => {
  assert.equal(refusal(new Uint8Array(0x10)), golden.errors.tooSmall);
  assert.equal(refusal(new Uint8Array(100)), golden.errors.zeros);
  assert.equal(refusal(sample.slice(0, 0x40)), golden.errors.truncated);
  assert.equal(refusal(sample.slice(0, 4000)), golden.errors.cutEntries);
});

test("a patch reports whether it changed anything", () => {
  assert.equal(patchSave(sample, (context) => ownAllGear(context)).changed, false);
  assert.equal(patchSave(noGear, (context) => ownAllGear(context)).changed, true);
  assert.equal(patchSave(sample, (context) => applyGearPreset(context, golden.preset)).changed, true);
});

test("coins accept whole numbers up to 2^32 - 1", () => {
  assert.deepEqual(parseCoins(" 4294967295 "), { ok: true, value: 4_294_967_295 });
  for (const raw of ["4294967296", "-1", "1.5", "", "1e3"]) assert.equal(parseCoins(raw).ok, false, raw);
});
