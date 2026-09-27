import assert from "node:assert/strict";
import test from "node:test";
import { normalizeText, toText } from "./text.ts";

test("falsy values become empty text, everything else its string form", () => {
  for (const value of [null, undefined, 0, false, "", Number.NaN]) assert.equal(toText(value), "");
  assert.equal(toText(42), "42");
  assert.equal(toText(" a "), " a ");
  assert.equal(normalizeText("  GoldCobra \n"), "GoldCobra");
});
