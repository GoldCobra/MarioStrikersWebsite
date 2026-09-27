import assert from "node:assert/strict";
import { test } from "node:test";
import { FLAG_CODE_ALIASES, normalizeCountryCode } from "./countries.ts";

test("passes through ISO two-letter codes lowercased and trimmed", () => {
  assert.equal(normalizeCountryCode("US"), "us");
  assert.equal(normalizeCountryCode("  de  "), "de");
});

test("resolves UK and home-nation aliases", () => {
  assert.equal(normalizeCountryCode("UK"), "gb");
  assert.equal(normalizeCountryCode("United Kingdom"), "gb");
  assert.equal(normalizeCountryCode("England"), "gb-eng");
  assert.equal(normalizeCountryCode("scotland"), "gb-sct");
  assert.equal(normalizeCountryCode("Northern Ireland"), "gb-nir");
});

test("keeps valid gb- subdivisions and rejects junk", () => {
  assert.equal(normalizeCountryCode("gb-wls"), "gb-wls");
  assert.equal(normalizeCountryCode("usa"), "");
  assert.equal(normalizeCountryCode(""), "");
  assert.equal(normalizeCountryCode(null), "");
});

test("aliases are frozen and never match Object.prototype members", () => {
  assert.equal(Object.isFrozen(FLAG_CODE_ALIASES), true);
  assert.equal(normalizeCountryCode("constructor"), "");
  assert.equal(normalizeCountryCode("__proto__"), "");
});
