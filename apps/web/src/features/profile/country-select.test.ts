import assert from "node:assert/strict";
import test from "node:test";
import { countryOptions, NO_COUNTRY_LABEL, typeaheadIndex } from "./country-select.ts";

const OPTIONS = countryOptions([
  { code: "se", name: "Sweden" },
  { code: "de", name: "Germany" },
  { code: "england", name: "England" },
  { code: "northern_ireland", name: "Northern Ireland" },
  { code: "es", name: "Spain" },
  { code: "ax", name: "Åland Islands" },
  { code: "ch", name: "Switzerland" },
  { code: "de", name: "Germany" },
]);

test("the list starts with no country, then every country once, alphabetically", () => {
  assert.deepEqual(
    OPTIONS.map((option) => option.label),
    [NO_COUNTRY_LABEL, "Åland Islands", "England", "Germany", "Northern Ireland", "Spain", "Sweden", "Switzerland"],
  );
  assert.deepEqual(
    OPTIONS.map((option) => option.flag),
    ["", "ax", "gb-eng", "de", "gb-nir", "es", "se", "ch"],
  );
  // The value sent is the list's own code.
  assert.equal(OPTIONS.find((option) => option.flag === "gb-nir")?.value, "northern_ireland");
});

test("typing jumps to the first country with that start", () => {
  assert.equal(OPTIONS[typeaheadIndex(OPTIONS, "g", 0)]?.label, "Germany");
  assert.equal(OPTIONS[typeaheadIndex(OPTIONS, "sw", 0)]?.label, "Sweden");
  assert.equal(OPTIONS[typeaheadIndex(OPTIONS, "swi", 6)]?.label, "Switzerland");
  // Accents do not matter.
  assert.equal(OPTIONS[typeaheadIndex(OPTIONS, "a", 0)]?.label, "Åland Islands");
  assert.equal(typeaheadIndex(OPTIONS, "x", 0), -1);
});

test("the same letter again steps through the countries with it", () => {
  const first = typeaheadIndex(OPTIONS, "s", 0);
  assert.equal(OPTIONS[first]?.label, "Spain");
  assert.equal(OPTIONS[typeaheadIndex(OPTIONS, "ss", first)]?.label, "Sweden");
  assert.equal(OPTIONS[typeaheadIndex(OPTIONS, "sss", typeaheadIndex(OPTIONS, "ss", first))]?.label, "Switzerland");
  // After the last it wraps around.
  assert.equal(OPTIONS[typeaheadIndex(OPTIONS, "s", OPTIONS.length - 1)]?.label, "Spain");
});
