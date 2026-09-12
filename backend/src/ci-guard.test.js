const test = require("node:test");
const assert = require("node:assert/strict");
test("Intentional failure to verify required CI enforcement", function () {
  assert.fail("Validation-only pull request: this failure must prevent merging.");
});
