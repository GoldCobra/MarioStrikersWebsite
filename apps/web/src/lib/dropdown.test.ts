import assert from "node:assert/strict";
import test from "node:test";
import { DROPDOWN_EDGE, DROPDOWN_GAP, DROPDOWN_MAX_HEIGHT, dropdownPlacement, typeaheadIndex } from "./dropdown.ts";

// A field 24px tall in a window 800px tall; the list's own height is `content`.
const field = (top: number) => ({ top, bottom: top + 24, viewport: 800 });

test("the list opens below the field, as tall as its options", () => {
  assert.deepEqual(dropdownPlacement({ ...field(100), content: 120 }), {
    up: false,
    height: 120,
    top: 124 + DROPDOWN_GAP,
  });
});

test("a long list is at most 280px tall and scrolls", () => {
  assert.equal(DROPDOWN_MAX_HEIGHT, 280);
  assert.equal(dropdownPlacement({ ...field(100), content: 2000 }).height, 280);
});

test("without room below it opens above, when there is more room there", () => {
  const placed = dropdownPlacement({ ...field(700), content: 200 });
  assert.equal(placed.up, true);
  assert.equal(placed.height, 200);
  // It ends just above the field.
  assert.equal(placed.top + placed.height, 700 - DROPDOWN_GAP);
});

test("it stays below while its options fit there, even with more room above", () => {
  const placed = dropdownPlacement({ ...field(600), content: 120 });
  assert.equal(placed.up, false);
  assert.equal(placed.height, 120);
});

test("with too little room on both sides it takes the larger one and fits into it", () => {
  // 300px window, field in the middle: 128px above, 124px below the field.
  const middle = dropdownPlacement({ top: 138, bottom: 162, viewport: 300, content: 600 });
  assert.equal(middle.up, false);
  assert.equal(middle.height, 300 - 162 - DROPDOWN_GAP - DROPDOWN_EDGE);
  assert.ok(middle.top + middle.height <= 300 - DROPDOWN_EDGE);
  const low = dropdownPlacement({ top: 200, bottom: 224, viewport: 300, content: 600 });
  assert.equal(low.up, true);
  assert.equal(low.height, 200 - DROPDOWN_GAP - DROPDOWN_EDGE);
  assert.equal(low.top, DROPDOWN_EDGE);
});

test("a field scrolled out of the window gives the list no negative height", () => {
  assert.equal(dropdownPlacement({ top: 900, bottom: 924, viewport: 800, content: 100 }).height, 100);
  assert.equal(dropdownPlacement({ top: -400, bottom: -376, viewport: 800, content: 100 }).height, 100);
  assert.ok(dropdownPlacement({ top: 900, bottom: 924, viewport: 800, content: 1000 }).height >= 0);
});

const OPTIONS = [
  { value: "", label: "None" },
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "b2", label: "Bravo" },
  { value: "e", label: "Écho" },
];

test("typing jumps to the next option with that start; options without a value are skipped", () => {
  assert.equal(typeaheadIndex(OPTIONS, "b", 0), 2);
  assert.equal(typeaheadIndex(OPTIONS, "br", 2), 3);
  assert.equal(typeaheadIndex(OPTIONS, "bb", 2), 3);
  assert.equal(typeaheadIndex(OPTIONS, "e", 0), 4);
  assert.equal(typeaheadIndex(OPTIONS, "n", 0), -1);
  assert.equal(typeaheadIndex(OPTIONS, "", 0), -1);
});
