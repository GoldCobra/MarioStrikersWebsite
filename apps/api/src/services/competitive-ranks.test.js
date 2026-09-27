const assert = require("node:assert/strict");
const test = require("node:test");
const { RANK_ORDER, normalizeCompetitiveRank } = require("./competitive-ranks");

test("RANK_ORDER is the five sequential community tiers", function () {
  assert.deepEqual(
    RANK_ORDER.map(function (rank) { return rank.code; }),
    ["rookie", "professional", "superstar", "legend", "megastriker"]
  );
});

test("maps numeric tier codes 1-5 to canonical ranks", function () {
  assert.equal(normalizeCompetitiveRank("1").code, "rookie");
  assert.equal(normalizeCompetitiveRank("3").code, "superstar");
  assert.equal(normalizeCompetitiveRank("5").name, "Megastriker");
});

test("maps name/code variants case- and punctuation-insensitively", function () {
  assert.equal(normalizeCompetitiveRank("Superstar").code, "superstar");
  assert.equal(normalizeCompetitiveRank("MEGA-STRIKER").code, "megastriker");
  assert.equal(normalizeCompetitiveRank("mega").code, "megastriker");
  assert.equal(normalizeCompetitiveRank("professional").code, "professional");
});

test("returns null for empty or unknown input", function () {
  assert.equal(normalizeCompetitiveRank(""), null);
  assert.equal(normalizeCompetitiveRank(null), null);
  assert.equal(normalizeCompetitiveRank("diamond"), null);
  assert.equal(normalizeCompetitiveRank("6"), null);
});
