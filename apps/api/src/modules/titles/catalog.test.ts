import assert from "node:assert/strict";
import test from "node:test";
import { GIANT, GOLDCOBRA, TITLE_CATALOG, TITLE_CATEGORIES, seededCatalog } from "./catalog.ts";
import { TITLE_GAMES } from "./games.ts";

test("the catalog holds the 63 titles of the title list and the 18 game variants of 2026-10-02", () => {
  const counts: Record<string, number> = {};
  for (const title of TITLE_CATALOG) counts[title.category] = (counts[title.category] ?? 0) + 1;
  assert.deepEqual(counts, { msl: 40, tournament: 8, "special-pre-2014": 5, "legacy-rank": 5, free: 23 });
  assert.equal(TITLE_CATALOG.filter((title) => title.gameCode).length, 18);
  assert.deepEqual(
    TITLE_CATEGORIES.map((category) => category.code),
    ["special-pre-2014", "msl", "competitive-season", "tournament", "legacy-rank", "free"],
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
      case "fixed-players": {
        const players = params.players as { player_id: number; discord_id: string }[];
        assert.ok(Array.isArray(players) && players.length > 0, title.code);
        for (const player of players) {
          assert.ok(Number.isInteger(player.player_id) && /^\d{17,20}$/.test(player.discord_id), title.code);
        }
        break;
      }
      case "msl-event":
        assert.equal(title.category, "msl", title.code);
        assert.ok(Array.isArray(params.names), title.code);
        assert.equal(title.gameCode, undefined, title.code);
        break;
      case "world-championship-count":
        assert.ok(Number.isInteger(params.min) && Number(params.min) > 0, title.code);
        assert.equal(title.exclusiveLevel, params.min, title.code);
        break;
      case "side-tournament-count":
        assert.ok(Number.isInteger(params.min) && Number(params.min) > 0, title.code);
        assert.equal(title.exclusiveGroup, undefined, title.code);
        break;
      case "legacy-rank":
        assert.ok([1, 2, 3, 4, 5].includes(Number(params.tier)), title.code);
        assert.equal(title.exclusiveGroup, "legacy-rank", title.code);
        assert.equal(title.gameCode, undefined, "legacy ranks stay without a game (owner, 2026-10-02)");
        break;
      default:
        assert.fail(`${title.code}: ${title.ruleKind}`);
    }
  }
});

test("every MSL event is a template; only the 2025 spring one waits for its tournament", () => {
  const templates = TITLE_CATALOG.filter((title) => title.ruleKind === "msl-event");
  assert.equal(templates.length, 24);
  assert.deepEqual(
    templates.filter((title) => !(title.ruleParams?.names as unknown[]).length).map((title) => title.code),
    ["msl-2025-spring-champion"],
  );
});

test("the titles without a game that counted wins are retired; their variants count per game", () => {
  assert.deepEqual(
    TITLE_CATALOG.filter((title) => title.isActive === false).map((title) => title.code),
    [
      "msl-5-time-world-champion",
      "msl-4-time-world-champion",
      "msl-3-time-world-champion",
      "msl-2-time-world-champion",
      "tournament-winner",
      "tournament-winner-green",
    ],
  );
  for (const game of TITLE_GAMES) {
    const of = (code: string) => TITLE_CATALOG.find((title) => title.code === `${code}-${game.suffix}`);
    for (const min of [2, 3, 4, 5]) {
      const title = of(`msl-${String(min)}-time-world-champion`);
      assert.equal(title?.name, `${String(min)}-TIME WORLD CHAMPION`);
      assert.equal(title.gameCode, game.code);
      assert.equal(title.exclusiveGroup, `msl-world-championships-${game.suffix}`);
    }
    const plain = of("tournament-winner");
    const green = of("tournament-winner-green");
    assert.deepEqual(
      [plain?.name, plain?.ruleParams, plain?.styleKey, plain?.gameCode],
      ["TOURNAMENT WINNER", { min: 1 }, undefined, game.code],
    );
    assert.deepEqual(
      [green?.name, green?.ruleParams, green?.styleKey, green?.gameCode],
      ["TOURNAMENT WINNER", { min: 5 }, "green", game.code],
    );
  }
});

test("four WFC titles belong to their record holders for good", () => {
  const owners = Object.fromEntries(
    TITLE_CATALOG.filter((title) => title.ruleKind === "fixed-players").map((title) => [
      title.code,
      title.ruleParams?.players,
    ]),
  );
  assert.deepEqual(owners, {
    "wfc-200-0-season-world-record": [GOLDCOBRA],
    "wfc-66-0-daily-world-record": [GOLDCOBRA],
    "wfc-5012-daily-points-world-record": [GIANT],
    "wfc-final-daily-leader": [GOLDCOBRA],
  });
  assert.deepEqual(GOLDCOBRA, { player_id: 223, discord_id: "195905866527014912" });
  assert.deepEqual(GIANT, { player_id: 17, discord_id: "110442894686453760" });
});

test("the seeded catalog is the list as the database holds it", () => {
  const seeded = seededCatalog();
  assert.equal(seeded.length, TITLE_CATALOG.length);
  assert.deepEqual(
    seeded.map((title) => title.id),
    TITLE_CATALOG.map((_, index) => index + 1),
  );
  // The 63 titles of #66 keep their place; the game variants come after them.
  assert.equal(seeded.find((title) => title.code === "wins-without-a-goalie")?.id, 63);
  const champion = seeded.find((title) => title.code === "msl-2023-world-champion");
  assert.deepEqual(champion && JSON.parse(champion.ruleParams), { names: ["MSL 2023 World Championship"] });
  assert.equal(champion?.ruleKind, "msl-event");
  assert.equal(champion.categoryName, "MSL Titles");
  assert.equal(seeded.find((title) => title.code === "og-player")?.isGlobal, true);
  assert.equal(seeded.find((title) => title.code === "tournament-winner")?.isActive, false);
  assert.equal(seeded.find((title) => title.code === "tournament-winner-sms")?.gameCode, "SMS");
  assert.equal(seeded.find((title) => title.code === "og-player")?.gameCode, "");
});
