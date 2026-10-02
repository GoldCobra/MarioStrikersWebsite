import assert from "node:assert/strict";
import test from "node:test";
import { TITLE_CATALOG, TITLE_CATEGORIES, seededCatalog } from "./catalog.ts";

test("the catalog holds the 63 titles of the title list in their categories", () => {
  const counts: Record<string, number> = {};
  for (const title of TITLE_CATALOG) counts[title.category] = (counts[title.category] ?? 0) + 1;
  assert.deepEqual(counts, { msl: 28, tournament: 2, "special-pre-2014": 5, "legacy-rank": 5, free: 23 });
  assert.deepEqual(
    TITLE_CATEGORIES.map((category) => category.code),
    ["msl", "competitive-season", "tournament", "special-pre-2014", "legacy-rank", "free"],
  );
  assert.deepEqual(
    TITLE_CATEGORIES.filter((category) => category.isGlobal).map((category) => category.code),
    ["free"],
  );
});

test("every title is FULL CAPS with a unique code that fits the database", () => {
  const codes = new Set<string>();
  for (const title of TITLE_CATALOG) {
    assert.equal(title.name, title.name.toUpperCase(), title.code);
    assert.equal(title.name, title.name.trim(), title.code);
    assert.ok(title.name.length > 0 && title.name.length <= 60, title.code);
    assert.match(title.code, /^[a-z0-9-]{1,64}$/);
    assert.ok(!codes.has(title.code), `duplicate ${title.code}`);
    codes.add(title.code);
    assert.ok(
      TITLE_CATEGORIES.some((category) => category.code === title.category),
      title.code,
    );
  }
});

test("every rule has the parameters its kind needs", () => {
  for (const title of TITLE_CATALOG) {
    const params = title.ruleParams ?? {};
    switch (title.ruleKind) {
      case "everyone":
        assert.equal(title.category, "free", title.code);
        break;
      case "manual":
        assert.equal(title.ruleParams, undefined, title.code);
        break;
      case "tournament-name":
        assert.ok(Array.isArray(params.names) && params.names.length > 0, title.code);
        break;
      case "world-championship-count":
      case "side-tournament-count":
        assert.ok(Number.isInteger(params.min) && Number(params.min) > 0, title.code);
        assert.equal(title.exclusiveLevel, params.min, title.code);
        break;
      case "legacy-rank":
        assert.ok([1, 2, 3, 4, 5].includes(Number(params.tier)), title.code);
        assert.equal(title.exclusiveGroup, "legacy-rank", title.code);
        break;
      default:
        assert.fail(`${title.code}: ${title.ruleKind}`);
    }
  }
});

test("the green TOURNAMENT WINNER is a level of the same group with its own look", () => {
  const winners = TITLE_CATALOG.filter((title) => title.name === "TOURNAMENT WINNER");
  assert.deepEqual(
    winners.map((title) => [title.code, title.exclusiveGroup, title.exclusiveLevel, title.styleKey ?? ""]),
    [
      ["tournament-winner", "tournament-winner", 1, ""],
      ["tournament-winner-green", "tournament-winner", 5, "green"],
    ],
  );
});

test("the seeded catalog is the list as the database holds it", () => {
  const seeded = seededCatalog();
  assert.equal(seeded.length, TITLE_CATALOG.length);
  assert.deepEqual(
    seeded.map((title) => title.id),
    TITLE_CATALOG.map((_, index) => index + 1),
  );
  const champion = seeded.find((title) => title.code === "msl-2023-world-champion");
  assert.deepEqual(champion && JSON.parse(champion.ruleParams), { names: ["MSL 2023 World Championship"] });
  assert.equal(champion?.categoryName, "MSL Titles");
  assert.equal(seeded.find((title) => title.code === "og-player")?.isGlobal, true);
});
