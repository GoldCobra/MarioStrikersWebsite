import assert from "node:assert/strict";
import test from "node:test";
import {
  availableTitles,
  compareTitles,
  normalizeTitleCode,
  selectedTitle,
  titleLook,
  titleText,
  titleYear,
  toTitleOption,
  type CatalogTitle,
} from "./availability.ts";
import { seededCatalog } from "./catalog.ts";

const CATALOG = seededCatalog();
const id = (code: string): number => CATALOG.find((title) => title.code === code)?.id ?? 0;
const codes = (unlocked: readonly string[]): string[] =>
  availableTitles(CATALOG, unlocked.map(id)).map((title) => title.code);

test("every player can select every Free Title, also new ones, without unlock rows", () => {
  const free = CATALOG.filter((title) => title.category === "free").map((title) => title.code);
  assert.deepEqual([...codes([])].sort(), [...free].sort());
  const last = CATALOG.at(-1);
  assert.ok(last);
  const added = [...CATALOG, { ...last, id: 999, code: "new-free", sortOrder: 99 }];
  assert.ok(availableTitles(added, []).some((title) => title.code === "new-free"));
});

test("unlocked titles come first, by category, and the Free Titles last", () => {
  assert.deepEqual(codes(["legacy-legend", "msl-2023-world-champion", "tournament-winner"]).slice(0, 4), [
    "msl-2023-world-champion",
    "tournament-winner",
    "legacy-legend",
    "three-ghosts",
  ]);
});

test("of an exclusive group only the highest unlocked level is offered", () => {
  const offered = codes([
    "legacy-rookie",
    "legacy-superstar",
    "tournament-winner",
    "tournament-winner-green",
    "msl-2-time-world-champion",
    "msl-3-time-world-champion",
  ]);
  assert.ok(offered.includes("legacy-superstar") && !offered.includes("legacy-rookie"));
  assert.ok(offered.includes("msl-3-time-world-champion") && !offered.includes("msl-2-time-world-champion"));
  // The two TOURNAMENT WINNER titles are no group: both can be selected, the green one first.
  assert.deepEqual(
    offered.filter((code) => code.startsWith("tournament-winner")),
    ["tournament-winner-green", "tournament-winner"],
  );
});

function catalogTitle(code: string): CatalogTitle {
  const title = CATALOG.find((entry) => entry.code === code);
  if (!title) throw new Error(`No title ${code} in the catalog.`);
  return title;
}

/** A season title as the sync creates it when a season ends with a Strikers Titan. */
function seasonTitle(seasonId: number, seasonNumber: number, name: string): CatalogTitle {
  return {
    ...catalogTitle("legacy-rookie"),
    id: 900 + seasonId,
    code: `season-titan-${String(seasonId)}`,
    name,
    category: "competitive-season",
    categoryName: "Competitive Season Titles",
    categorySort: 3,
    sortOrder: seasonNumber,
    ruleKind: "season-titan",
    ruleParams: JSON.stringify({ season_id: seasonId }),
    exclusiveGroup: "",
    exclusiveLevel: 0,
  };
}

test("the list follows the owner's order of categories and titles", () => {
  const seasons = [
    seasonTitle(2, 1, "BURST 2026 STRIKERS TITAN"),
    seasonTitle(5, 4, "RISE 2027 STRIKERS TITAN"),
    seasonTitle(4, 3, "CHILL 2026 STRIKERS TITAN"),
    seasonTitle(3, 2, "DUSK 2026 STRIKERS TITAN"),
  ];
  const catalog = [...seasons, ...CATALOG];
  const unlocked = catalog.filter((title) => !title.isGlobal).map((title) => title.id);
  const order = availableTitles(catalog, unlocked).map((title) => title.code);
  const at = (prefix: string): string[] => order.filter((code) => code.startsWith(prefix));

  assert.deepEqual(order.slice(0, 5), [
    "wfc-200-0-season-world-record",
    "wfc-66-0-daily-world-record",
    "wfc-5012-daily-points-world-record",
    "wfc-final-daily-leader",
    "wfc-final-season-leader",
  ]);
  assert.deepEqual(at("msl-").slice(0, 6), [
    "msl-5-time-world-champion",
    "msl-2026-world-champion",
    "msl-2026-fall-champion",
    "msl-2026-summer-champion",
    "msl-2026-spring-champion",
    "msl-2025-world-champion",
  ]);
  assert.deepEqual(at("msl-season-1-"), [
    "msl-season-1-world-champion",
    "msl-season-1-fall-champion",
    "msl-season-1-summer-champion",
    "msl-season-1-spring-champion",
  ]);
  assert.deepEqual(at("season-titan-"), ["season-titan-5", "season-titan-4", "season-titan-3", "season-titan-2"]);
  assert.deepEqual(at("tournament-winner"), ["tournament-winner-green", "tournament-winner"]);
  // Category blocks in order: special, MSL, season, tournament, legacy, free.
  const block = (code: string): string => catalog.find((title) => title.code === code)?.category ?? "";
  assert.deepEqual(
    [...new Set(order.map(block))],
    ["special-pre-2014", "msl", "competitive-season", "tournament", "legacy-rank", "free"],
  );
});

test("legacy ranks run from MEGASTRIKER down, Free Titles A-Z", () => {
  const legacy = CATALOG.filter((title) => title.category === "legacy-rank").sort(compareTitles);
  assert.deepEqual(
    legacy.map((title) => title.name),
    ["LEGACY MEGASTRIKER", "LEGACY LEGEND", "LEGACY SUPERSTAR", "LEGACY PROFESSIONAL", "LEGACY ROOKIE"],
  );
  const free = availableTitles(CATALOG, []).map((title) => title.name);
  assert.equal(free[0], "3 GHOSTS");
  assert.equal(free.at(-1), "WINS WITHOUT A GOALIE");
  for (let index = 1; index < free.length; index += 1) {
    assert.ok(
      (free[index - 1] ?? "").localeCompare(free[index] ?? "", "en", { sensitivity: "base", numeric: true }) <= 0,
    );
  }
});

test("a new category falls in before the Free Titles, whatever its place; equal ranks go by code", () => {
  const newCategory = (code: string, id: number): CatalogTitle => ({
    ...catalogTitle("legacy-rookie"),
    id,
    code,
    name: "EVENT HERO",
    category: "events",
    categoryName: "Event Titles",
    categorySort: 99,
    sortOrder: 1,
    ruleKind: "manual",
    ruleParams: "",
    exclusiveGroup: "",
    exclusiveLevel: 0,
  });
  const catalog = [newCategory("event-hero-b", 801), newCategory("event-hero-a", 802), ...CATALOG];
  const order = availableTitles(catalog, [801, 802, id("legacy-rookie")]).map((title) => title.code);
  const legacy = order.indexOf("legacy-rookie");
  assert.equal(order.indexOf("event-hero-a"), legacy + 1);
  assert.equal(order.indexOf("event-hero-b"), legacy + 2);
  assert.equal(order[legacy + 3], "three-ghosts");
});

test("a title's year comes from its name; MSL Season 1 is 2021", () => {
  assert.equal(titleYear("MSL 2025 FALL CHAMPION"), 2025);
  assert.equal(titleYear("MSL SEASON 1 SPRING CHAMPION"), 2021);
  assert.equal(titleYear("CHILL 2026 STRIKERS TITAN"), 2026);
  assert.equal(titleYear("OG PLAYER"), 0);
});

test("an inactive title is offered to nobody, unlocked or not", () => {
  const retired = CATALOG.map((title) =>
    title.code === "og-player" || title.code === "legacy-legend" ? { ...title, isActive: false } : title,
  );
  const offered = availableTitles(retired, [id("legacy-legend"), id("legacy-rookie")]).map((title) => title.code);
  assert.ok(!offered.includes("og-player") && !offered.includes("legacy-legend"));
  assert.ok(offered.includes("legacy-rookie"), "the next level of the group takes its place");
});

test("the selected title counts only while the player can select it", () => {
  assert.equal(selectedTitle(CATALOG, [], id("og-player"))?.code, "og-player");
  assert.equal(selectedTitle(CATALOG, [], id("msl-2023-world-champion")), null);
  assert.equal(selectedTitle(CATALOG, [id("legacy-rookie"), id("legacy-legend")], id("legacy-rookie")), null);
  assert.equal(selectedTitle(CATALOG, [], null), null);
});

test("titles are shown in FULL CAPS and codes taken in lower case", () => {
  assert.equal(titleText("  og player "), "OG PLAYER");
  assert.equal(normalizeTitleCode(" OG-Player "), "og-player");
  const green = CATALOG.find((title) => title.code === "tournament-winner-green");
  assert.ok(green);
  assert.deepEqual(toTitleOption(green), {
    code: "tournament-winner-green",
    name: "TOURNAMENT WINNER",
    category: "tournament",
    categoryName: "Tournament Titles",
    style: "tournament-x5",
  });
});

test("every title has the look of its group: colour and glow are set once per look", () => {
  const looks = Object.fromEntries(CATALOG.map((title) => [title.code, titleLook(title)]));
  assert.equal(looks["og-player"], "free");
  assert.equal(looks["wfc-final-season-leader"], "special");
  assert.equal(looks["msl-2025-world-champion"], "msl-world");
  assert.equal(looks["msl-season-1-world-champion"], "msl-world");
  assert.equal(looks["msl-5-time-world-champion"], "msl-world");
  assert.equal(looks["msl-2-time-world-champion"], "msl-world");
  assert.equal(looks["msl-2025-fall-champion"], "msl");
  assert.equal(looks["msl-2026-spring-champion"], "msl");
  assert.equal(looks["msl-season-1-summer-champion"], "msl");
  assert.equal(looks["tournament-winner"], "tournament");
  assert.equal(looks["tournament-winner-green"], "tournament-x5");
  assert.equal(looks["legacy-megastriker"], "legacy");
  assert.equal(titleLook(seasonTitle(7, 3, "CHILL 2026 STRIKERS TITAN")), "season");
  assert.equal(titleLook({ category: "events", name: "EVENT HERO", styleKey: "" }), "plain");
  assert.equal(toTitleOption(catalogTitle("tournament-winner-green")).style, "tournament-x5");
});
