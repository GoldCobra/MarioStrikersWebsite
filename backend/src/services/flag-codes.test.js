const assert = require("node:assert/strict");
const test = require("node:test");
const { FLAG_CODE_ALIASES, normalizeCountryCode } = require("./flag-codes");

test("passes through ISO two-letter codes lowercased and trimmed", function () {
  assert.equal(normalizeCountryCode("US"), "us");
  assert.equal(normalizeCountryCode("  de  "), "de");
});

test("resolves UK and home-nation aliases", function () {
  assert.equal(normalizeCountryCode("UK"), "gb");
  assert.equal(normalizeCountryCode("United Kingdom"), "gb");
  assert.equal(normalizeCountryCode("England"), "gb-eng");
  assert.equal(normalizeCountryCode("scotland"), "gb-sct");
  assert.equal(normalizeCountryCode("Northern Ireland"), "gb-nir");
});

test("keeps valid gb- subdivisions and rejects junk", function () {
  assert.equal(normalizeCountryCode("gb-wls"), "gb-wls");
  assert.equal(normalizeCountryCode("usa"), "");
  assert.equal(normalizeCountryCode(""), "");
  assert.equal(normalizeCountryCode(null), "");
});

test("FLAG_CODE_ALIASES is frozen", function () {
  assert.equal(Object.isFrozen(FLAG_CODE_ALIASES), true);
});
