import assert from "node:assert/strict";
import test from "node:test";
import {
  availableTitles,
  compareTitles,
  fixedTitleOwners,
  isTemplateTitle,
  normalizeTitleCode,
  selectedTitle,
  titleLook,
  titleText,
  titleYear,
  toTitleOption,
  type CatalogTitle,
} from "./availability.ts";
import { GIANT, GOLDCOBRA, TITLE_CATALOG, seededCatalog } from "./catalog.ts";
import { TITLE_GAMES, type TitleGameCode } from "./games.ts";

const CATALOG = seededCatalog();
const id = (code: string): number => CATALOG.find((title) => title.code === code)?.id ?? 0;
const codes = (unlocked: readonly string[]): string[] =>
  availableTitles(CATALOG, unlocked.map(id)).map((title) => title.code);

test("every player can select every Free Title, also new ones, without unlock rows", () => {
  const free = CATALOG.filter((title) => title.category === "free").map((title) => title.code);
  assert.deepEqual([...codes([])].sort(), [...free].sort());
  const last = CATALOG.filter((title) => title.category === "free").at(-1);
  assert.ok(last);
  const added = [...CATALOG, { ...last, id: 999, code: "new-free", sortOrder: 99 }];
  assert.ok(availableTitles(added, []).some((title) => title.code === "new-free"));
});

test("unlocked titles come first, by category, and the Free Titles last", () => {
  assert.deepEqual(codes(["legacy-legend", "msl-3-time-world-champion-msc", "tournament-winner-msbl"]).slice(0, 4), [
    "msl-3-time-world-champion-msc",
    "tournament-winner-msbl",
    "legacy-legend",
    "three-ghosts",
  ]);
});

test("of an exclusive group only the highest unlocked level is offered, per game", () => {
  const offered = codes([
    "legacy-rookie",
    "legacy-superstar",
    "tournament-winner-msbl",
    "tournament-winner-green-msbl",
    "tournament-winner-sms",
    "msl-2-time-world-champion-msc",
    "msl-3-time-world-champion-msc",
    "msl-2-time-world-champion-sms",
  ]);
  assert.ok(offered.includes("legacy-superstar") && !offered.includes("legacy-rookie"));
  assert.ok(offered.includes("msl-3-time-world-champion-msc") && !offered.includes("msl-2-time-world-champion-msc"));
  assert.ok(offered.includes("msl-2-time-world-champion-sms"), "another game is another group");
  // TOURNAMENT WINNER is no group: green and plain can both be selected, the green ones first.
  assert.deepEqual(
    offered.filter((code) => code.startsWith("tournament-winner")),
    ["tournament-winner-green-msbl", "tournament-winner-msbl", "tournament-winner-sms"],
  );
});

test("templates and retired titles are offered to nobody, also with their old unlocks", () => {
  const offered = codes([
    "msl-2023-world-champion",
    "tournament-winner",
    "tournament-winner-green",
    "msl-3-time-world-champion",
  ]);
  assert.ok(offered.every((code) => CATALOG.find((title) => title.code === code)?.isGlobal));
  assert.equal(isTemplateTitle(catalogTitle("msl-2023-world-champion")), true);
  assert.equal(isTemplateTitle(catalogTitle("msl-3-time-world-champion-msc")), false);
});

test("a fixed title is offered only to its player", () => {
  const unlocked = [id("wfc-200-0-season-world-record"), id("wfc-5012-daily-points-world-record")];
  const of = (playerId?: number): string[] =>
    availableTitles(CATALOG, unlocked, { playerId })
      .filter((title) => title.category === "special-pre-2014")
      .map((title) => title.code);
  assert.deepEqual(of(GOLDCOBRA.player_id), ["wfc-200-0-season-world-record"]);
  assert.deepEqual(of(GIANT.player_id), ["wfc-5012-daily-points-world-record"]);
  assert.deepEqual(of(5), []);
  assert.deepEqual(of(), []);
  assert.deepEqual([...(fixedTitleOwners(catalogTitle("wfc-final-daily-leader")) ?? [])], [GOLDCOBRA.player_id]);
  assert.equal(fixedTitleOwners(catalogTitle("wfc-final-season-leader")), null);
});

test("test unlocks add every title on top, every level, but never a template or a retired title", () => {
  const tests = [
    "msl-5-time-world-champion-msbl",
    "msl-2-time-world-champion-msbl",
    "wfc-5012-daily-points-world-record",
    "legacy-rookie",
    "legacy-megastriker",
    "msl-2023-world-champion",
    "tournament-winner",
  ].map(id);
  const offered = availableTitles(CATALOG, [id("legacy-superstar")], {
    playerId: GOLDCOBRA.player_id,
    testUnlockedIds: tests,
  }).map((title) => title.code);
  for (const code of [
    "msl-5-time-world-champion-msbl",
    "msl-2-time-world-champion-msbl",
    "wfc-5012-daily-points-world-record",
    "legacy-megastriker",
    "legacy-superstar",
    "legacy-rookie",
  ]) {
    assert.ok(offered.includes(code), code);
  }
  assert.ok(!offered.includes("msl-2023-world-champion") && !offered.includes("tournament-winner"));
  // Without the test unlocks the player keeps exactly what they earned.
  assert.deepEqual(
    availableTitles(CATALOG, [id("legacy-superstar")], { playerId: GOLDCOBRA.player_id })
      .filter((title) => !title.isGlobal)
      .map((title) => title.code),
    ["legacy-superstar"],
  );
});

function catalogTitle(code: string): CatalogTitle {
  const title = CATALOG.find((entry) => entry.code === code);
  if (!title) throw new Error(`No title ${code} in the catalog.`);
  return title;
}

/** A season title as the sync creates it when a season ends with a Strikers Titan in a game. */
function seasonTitle(
  seasonId: number,
  seasonNumber: number,
  name: string,
  gameCode: TitleGameCode = "MSBL",
): CatalogTitle {
  const gameIndex = TITLE_GAMES.findIndex((entry) => entry.code === gameCode);
  return {
    ...catalogTitle("legacy-rookie"),
    id: 900 + seasonId * 10 + gameIndex,
    code: `season-titan-${String(seasonId)}-${TITLE_GAMES[gameIndex]?.suffix ?? ""}`,
    name,
    category: "competitive-season",
    categoryName: "Competitive Season Titles",
    categorySort: 3,
    sortOrder: seasonNumber,
    ruleKind: "season-titan",
    ruleParams: JSON.stringify({ season_id: seasonId }),
    exclusiveGroup: "",
    exclusiveLevel: 0,
    gameCode,
  };
}

/** Every MSL event's variant of every game, as the sync creates them from the templates. */
function mslVariants(): CatalogTitle[] {
  return CATALOG.filter((title) => isTemplateTitle(title)).flatMap((template, index) =>
    TITLE_GAMES.map((game, gameIndex) => ({
      ...template,
      id: 2000 + index * 3 + gameIndex,
      code: `${template.code}-${game.suffix}`,
      ruleKind: "tournament-name",
      gameCode: game.code,
    })),
  );
}

test("the list follows the owner's order of categories and titles", () => {
  const seasons = [
    seasonTitle(2, 1, "BURST 2026 STRIKERS TITAN", "SMS"),
    seasonTitle(2, 1, "BURST 2026 STRIKERS TITAN", "MSBL"),
    seasonTitle(5, 4, "RISE 2027 STRIKERS TITAN"),
    seasonTitle(4, 3, "CHILL 2026 STRIKERS TITAN"),
    seasonTitle(3, 2, "DUSK 2026 STRIKERS TITAN", "MSC"),
  ];
  const catalog = [...seasons, ...mslVariants(), ...CATALOG];
  const unlocked = catalog.filter((title) => !title.isGlobal).map((title) => title.id);
  // GoldCobra with every title as a test unlock, the way the owner tests the list: every level of a group.
  const order = availableTitles(catalog, unlocked, { playerId: GOLDCOBRA.player_id, testUnlockedIds: unlocked }).map(
    (title) => title.code,
  );
  // Regular unlocks alone offer only the highest N-TIME of each game.
  assert.deepEqual(
    availableTitles(catalog, unlocked, { playerId: GOLDCOBRA.player_id })
      .map((title) => title.code)
      .filter((code) => code.includes("-time-")),
    TITLE_GAMES.map((game) => `msl-5-time-world-champion-${game.suffix}`),
  );
  const at = (prefix: string): string[] => order.filter((code) => code.startsWith(prefix));
  const games = TITLE_GAMES.map((game) => game.suffix);

  assert.deepEqual(order.slice(0, 5), [
    "wfc-200-0-season-world-record",
    "wfc-66-0-daily-world-record",
    "wfc-5012-daily-points-world-record",
    "wfc-final-daily-leader",
    "wfc-final-season-leader",
  ]);
  // MSL in the owner's groups: X-TIME (5 down to 2), then WORLD, FALL, SUMMER, SPRING CHAMPION, each by year
  // (newest first, MSL SEASON 1 = 2021); the same title in several games in the order MSBL, MSC, SMS.
  const years = ["2026", "2025", "2024", "2023", "2022", "season-1"];
  assert.deepEqual(at("msl-"), [
    ...[5, 4, 3, 2].flatMap((times) => games.map((game) => `msl-${String(times)}-time-world-champion-${game}`)),
    ...["world", "fall", "summer", "spring"].flatMap((event) =>
      years.flatMap((year) => games.map((game) => `msl-${year}-${event}-champion-${game}`)),
    ),
  ]);
  assert.deepEqual(at("season-titan-"), [
    "season-titan-5-msbl",
    "season-titan-4-msbl",
    "season-titan-3-msc",
    "season-titan-2-msbl",
    "season-titan-2-sms",
  ]);
  assert.deepEqual(at("tournament-winner"), [
    ...games.map((game) => `tournament-winner-green-${game}`),
    ...games.map((game) => `tournament-winner-${game}`),
  ]);
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
  assert.equal(selectedTitle(CATALOG, [], id("msl-3-time-world-champion-msc")), null);
  assert.equal(selectedTitle(CATALOG, [id("msl-2023-world-champion")], id("msl-2023-world-champion")), null);
  assert.equal(selectedTitle(CATALOG, [id("legacy-rookie"), id("legacy-legend")], id("legacy-rookie")), null);
  assert.equal(selectedTitle(CATALOG, [], null), null);
  const wfc = id("wfc-66-0-daily-world-record");
  assert.equal(selectedTitle(CATALOG, [wfc], wfc, { playerId: GOLDCOBRA.player_id })?.id, wfc);
  assert.equal(selectedTitle(CATALOG, [wfc], wfc, { playerId: GIANT.player_id }), null);
  assert.equal(selectedTitle(CATALOG, [], wfc, { playerId: GIANT.player_id, testUnlockedIds: [wfc] })?.id, wfc);
});

test("titles are shown in FULL CAPS and codes taken in lower case", () => {
  assert.equal(titleText("  og player "), "OG PLAYER");
  assert.equal(normalizeTitleCode(" OG-Player "), "og-player");
  const green = CATALOG.find((title) => title.code === "tournament-winner-green-msc");
  assert.ok(green);
  assert.deepEqual(toTitleOption(green), {
    code: "tournament-winner-green-msc",
    name: "TOURNAMENT WINNER",
    category: "tournament",
    categoryName: "Tournament Titles",
    style: "tournament-x5",
    gameCode: "MSC",
  });
  assert.equal(toTitleOption(catalogTitle("og-player")).gameCode, "");
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
  assert.equal(looks["msl-4-time-world-champion-sms"], "msl-world");
  assert.equal(looks["tournament-winner-msbl"], "tournament");
  assert.equal(looks["tournament-winner-green-sms"], "tournament-x5");
  assert.equal(looks["legacy-megastriker"], "legacy");
  // Every game variant keeps the look of the title it replaces.
  for (const title of TITLE_CATALOG.filter((entry) => entry.gameCode)) {
    const base = title.code.replace(/-(?:msbl|msc|sms)$/, "");
    assert.equal(looks[title.code], looks[base], title.code);
  }
  assert.equal(titleLook(seasonTitle(7, 3, "CHILL 2026 STRIKERS TITAN")), "season");
  assert.equal(titleLook({ category: "events", name: "EVENT HERO", styleKey: "" }), "plain");
  assert.equal(toTitleOption(catalogTitle("tournament-winner-green")).style, "tournament-x5");
});
