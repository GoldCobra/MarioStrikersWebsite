import assert from "node:assert/strict";
import test from "node:test";
import type { CatalogTitle } from "./availability.ts";
import { seededCatalog } from "./catalog.ts";
import {
  legacyTier,
  parseWinners,
  planTitleAwards,
  seasonTitanTitleName,
  type TitleSources,
  type TournamentRow,
} from "./rules.ts";

const CATALOG = seededCatalog();
const id = (code: string): number => CATALOG.find((title) => title.code === code)?.id ?? 0;

/** A season title as staff or a sync would add it to dbo.PlayerTitle. */
function seasonTitle(fields: Pick<CatalogTitle, "id" | "code" | "name" | "ruleParams">): CatalogTitle {
  return {
    ...fields,
    category: "competitive-season",
    categoryName: "Competitive Season Titles",
    categorySort: 2,
    isGlobal: false,
    sortOrder: 1,
    ruleKind: "season-titan",
    styleKey: "",
    exclusiveGroup: "",
    exclusiveLevel: 0,
    isActive: true,
  };
}

let nextTournament = 1;
function tournament(name: string, winner: string, extra: Partial<TournamentRow> = {}): TournamentRow {
  const tournamentId = nextTournament++;
  return {
    id: tournamentId,
    name,
    gameType: 1,
    isComplete: true,
    winner,
    startDate: `2024-01-${String(tournamentId).padStart(2, "0")}`,
    ...extra,
  };
}

function sources(overrides: Partial<TitleSources> = {}): TitleSources {
  nextTournament = 1;
  return {
    catalog: CATALOG,
    unlocks: [],
    playerIds: new Set([1, 2, 3, 4, 5, 6, 7, 8]),
    tournaments: [
      tournament("MSL 2023 World Championship", "1"),
      tournament("MSL 2024 World Championship", "1", { gameType: 3 }),
      tournament("MSL 2023 Summer Split - Premier Event", "", { gameType: 3 }),
      tournament("MSL 2023 Summer Split - Premier Event", "2"),
      tournament("Funky Cup", "2"),
      tournament("Bruiser Cup", "2", { gameType: 3 }),
      tournament("Weekly #1", "2"),
      tournament("Weekly #2", "2"),
      tournament("Weekly #3", "2"),
      tournament("SMS Winter Doubles", ",3,4,", { gameType: 2 }),
      tournament("Bruiser Cup 2 - Consolation", "5", { gameType: 3 }),
      tournament("MSL '21 Summer Gauntlet", "6"),
      tournament("Gamblers Anon", "", { isComplete: false }),
      tournament("Some Cup", "999"),
      tournament("Never Finished Cup", "-1"),
    ],
    seasons: [
      { id: 2, seasonNumber: 1, displayName: "Burst Season 2026", status: "completed" },
      { id: 3, seasonNumber: 2, displayName: "Dusk Season 2026", status: "active" },
    ],
    titans: [
      { seasonId: 2, playerId: 7 },
      { seasonId: 3, playerId: 8 },
    ],
    legacyRanks: [
      { playerId: 1, gameType: 3, mode: "1v1", rank: 13, matchesBefore: 50 },
      { playerId: 2, gameType: 2, mode: "1v1", rank: 5, matchesBefore: 20 },
      { playerId: 2, gameType: 3, mode: "2v2", rank: 8, matchesBefore: 6 },
      { playerId: 3, gameType: 1, mode: "1v1", rank: 10, matchesBefore: 4 },
      { playerId: 4, gameType: 1, mode: "1v1", rank: 2, matchesBefore: 12 },
      { playerId: 4, gameType: 3, mode: "1v1", rank: 7, matchesBefore: 8 },
    ],
    ...overrides,
  };
}

const describe = (plan: ReturnType<typeof planTitleAwards>): string[] =>
  plan.grants.map((grant) => `${grant.titleCode}:${grant.playerId}:${grant.sourceType}`);

test("winner columns, legacy tiers and season title names are read strictly", () => {
  assert.deepEqual(parseWinners("5"), [5]);
  assert.deepEqual(parseWinners(",51,5,"), [51, 5]);
  assert.deepEqual(parseWinners(" 9 , 9 "), [9]);
  assert.deepEqual(parseWinners(""), []);
  assert.equal(parseWinners("-1"), null);
  assert.equal(parseWinners("12,abc"), null);
  assert.deepEqual([0, 1, 3, 4, 6, 7, 9, 10, 12, 13, 14].map(legacyTier), [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 0]);
  assert.equal(seasonTitanTitleName("Dusk Season 2026"), "DUSK 2026 STRIKERS TITAN");
  assert.equal(seasonTitanTitleName("Chill Season 2026"), "CHILL 2026 STRIKERS TITAN");
});

test("the data awards exactly the clear titles, with their sources", () => {
  const plan = planTitleAwards(sources());
  assert.deepEqual(describe(plan).sort(), [
    "legacy-megastriker:1:LEGACY_RANK",
    "legacy-rookie:4:LEGACY_RANK",
    "legacy-superstar:2:LEGACY_RANK",
    "msl-2-time-world-champion:1:ACCOLADE",
    "msl-2023-summer-champion:2:ACCOLADE",
    "msl-2023-world-champion:1:ACCOLADE",
    "msl-2024-world-champion:1:ACCOLADE",
    "season-titan-2:7:SEASON",
    "tournament-winner-green:2:TOURNAMENT",
    "tournament-winner:2:TOURNAMENT",
  ]);
  const byCode = new Map(plan.grants.map((grant) => [`${grant.titleCode}:${grant.playerId}`, grant.sourceRef]));
  assert.equal(byCode.get("msl-2023-world-champion:1"), "Tournament:1 MSL 2023 World Championship");
  assert.equal(byCode.get("msl-2-time-world-champion:1"), "Tournaments:1,2 (2 MSL World Championships)");
  assert.equal(byCode.get("tournament-winner-green:2"), "Tournaments:5,6,7,8,9 (5 non-MSL tournament wins)");
  assert.equal(byCode.get("legacy-superstar:2"), "PlayerStats:MSBL 2v2 rank 8");
  assert.equal(byCode.get("season-titan-2:7"), "CompetitiveSeason:2 Burst Season 2026");
  assert.deepEqual(plan.newTitles, [
    {
      code: "season-titan-2",
      name: "BURST 2026 STRIKERS TITAN",
      category: "competitive-season",
      sortOrder: 1,
      ruleKind: "season-titan",
      ruleParams: '{"season_id":2}',
    },
  ]);
});

test("unclear data awards nothing and is reported instead", () => {
  const { openPoints } = planTitleAwards(sources());
  const expected = [
    'Tournament 3 "MSL 2023 Summer Split - Premier Event" (MSBL): no winner recorded, so it awards MSL 2023 SUMMER CHAMPION to nobody.',
    'Tournament 10 "SMS Winter Doubles" (SMS): a team or doubles win, not counted for TOURNAMENT WINNER until staff decide.',
    'Tournament 11 "Bruiser Cup 2 - Consolation" (MSBL): a side bracket or division, not counted for TOURNAMENT WINNER until staff decide.',
    'Tournament 14 "Some Cup" (MSC): winner 999 is no player, so it awards nothing to them.',
    "Player 3: legacy Legend (MSC 1v1) rests on 4 matches before the competitive start (10 needed), not counted.",
    "Player 4: legacy Superstar (MSBL 1v1) rests on 8 matches before the competitive start (10 needed), not counted.",
  ];
  for (const text of expected) assert.ok(openPoints.includes(text), text);
  assert.ok(!openPoints.some((text) => text.includes("Gauntlet")), "MSL side events are no tournament wins at all");
  assert.ok(!openPoints.some((text) => text.includes("Gamblers Anon")), "an unfinished tournament is no open point");
});

test("a second run over its own result awards nothing new", () => {
  const first = planTitleAwards(sources());
  const created = first.newTitles.map((title, index) =>
    seasonTitle({ id: 1000 + index, code: title.code, name: title.name, ruleParams: title.ruleParams }),
  );
  const catalog = [...CATALOG, ...created];
  const titleId = (code: string): number => catalog.find((title) => title.code === code)?.id ?? 0;
  const second = planTitleAwards(
    sources({
      catalog,
      unlocks: first.grants.map((grant) => ({ playerId: grant.playerId, titleId: titleId(grant.titleCode) })),
    }),
  );
  assert.deepEqual(second.grants, []);
  assert.deepEqual(second.newTitles, []);
});

test("titles a player has are never planned again", () => {
  const plan = planTitleAwards(sources({ unlocks: [{ playerId: 1, titleId: id("msl-2023-world-champion") }] }));
  assert.ok(!describe(plan).includes("msl-2023-world-champion:1:ACCOLADE"));
  assert.ok(describe(plan).includes("msl-2024-world-champion:1:ACCOLADE"));
});

test("the daily run leaves the legacy ranks out; season titles wait for the season's end", () => {
  const plan = planTitleAwards(sources({ legacyRanks: undefined }));
  assert.ok(!plan.grants.some((grant) => grant.sourceType === "LEGACY_RANK"));
  assert.ok(!plan.grants.some((grant) => grant.playerId === 8), "Dusk 2026 is still running");
});

test("inactive titles, unknown rule kinds and broken parameters award nothing", () => {
  const catalog = CATALOG.map((title) => {
    if (title.code === "msl-2023-world-champion") return { ...title, isActive: false };
    if (title.code === "msl-2024-world-champion") return { ...title, ruleKind: "best-goals" };
    if (title.code === "tournament-winner") return { ...title, ruleParams: "{min:1" };
    return title;
  });
  const plan = planTitleAwards(sources({ catalog }));
  const granted = describe(plan);
  assert.ok(!granted.some((grant) => /^msl-202[34]-world-champion:/.test(grant)));
  assert.ok(!granted.some((grant) => grant.startsWith("tournament-winner:")));
  assert.ok(
    plan.openPoints.includes('Title msl-2024-world-champion: unknown rule kind "best-goals", so it awards nothing.'),
  );
  assert.ok(plan.openPoints.includes("Title tournament-winner: RuleParams is no JSON object, so it awards nothing."));
});

test("a season title created by staff is used, and a retired one stops the awards", () => {
  const staffTitle = seasonTitle({
    id: 500,
    code: "burst-titan",
    name: "BURST 2026 STRIKERS TITAN",
    ruleParams: '{"season_id":2}',
  });
  const used = planTitleAwards(sources({ catalog: [...CATALOG, staffTitle] }));
  assert.deepEqual(used.newTitles, []);
  assert.ok(describe(used).includes("burst-titan:7:SEASON"));
  const retired = planTitleAwards(sources({ catalog: [...CATALOG, { ...staffTitle, isActive: false }] }));
  assert.ok(!retired.grants.some((grant) => grant.sourceType === "SEASON"));
});
