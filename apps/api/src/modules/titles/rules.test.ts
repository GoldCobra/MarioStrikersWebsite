import assert from "node:assert/strict";
import test from "node:test";
import type { CatalogTitle } from "./availability.ts";
import { GIANT, GOLDCOBRA, seededCatalog } from "./catalog.ts";
import {
  countedWins,
  legacyTier,
  parseWinners,
  planTitleAwards,
  seasonTitanTitleName,
  type NewTitle,
  type TitleSources,
  type TournamentRow,
} from "./rules.ts";

const CATALOG = seededCatalog();
const id = (code: string): number => CATALOG.find((title) => title.code === code)?.id ?? 0;

/** A season title as staff or a sync would add it to dbo.PlayerTitle. */
function seasonTitle(
  fields: Pick<CatalogTitle, "id" | "code" | "name" | "ruleParams"> & Partial<Pick<CatalogTitle, "gameCode">>,
): CatalogTitle {
  return {
    gameCode: "",
    ...fields,
    category: "competitive-season",
    categoryName: "Competitive Season Titles",
    categorySort: 3,
    isGlobal: false,
    sortOrder: 1,
    ruleKind: "season-titan",
    styleKey: "",
    exclusiveGroup: "",
    exclusiveLevel: 0,
    isActive: true,
  };
}

/** A title the sync planned, as dbo.PlayerTitle holds it after the run. */
function created(title: NewTitle, titleId: number): CatalogTitle {
  return {
    id: titleId,
    code: title.code,
    name: title.name,
    category: title.category,
    categoryName: "",
    categorySort: 0,
    isGlobal: false,
    sortOrder: title.sortOrder,
    ruleKind: title.ruleKind,
    ruleParams: title.ruleParams,
    styleKey: "",
    exclusiveGroup: "",
    exclusiveLevel: 0,
    gameCode: title.gameCode,
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

const OWNERS = new Map<number, string>([
  [GOLDCOBRA.player_id, GOLDCOBRA.discord_id],
  [GIANT.player_id, GIANT.discord_id],
]);

function sources(overrides: Partial<TitleSources> = {}): TitleSources {
  nextTournament = 1;
  return {
    catalog: CATALOG,
    unlocks: [],
    playerIds: new Set([1, 2, 3, 4, 5, 6, 7, 8, GIANT.player_id, GOLDCOBRA.player_id]),
    discordIds: OWNERS,
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
      { seasonId: 2, playerId: 7, gameType: 3 },
      { seasonId: 3, playerId: 8, gameType: 3 },
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

test("the data awards exactly the clear titles of each game, with their sources", () => {
  const plan = planTitleAwards(sources());
  assert.deepEqual(describe(plan).sort(), [
    "legacy-megastriker:1:LEGACY_RANK",
    "legacy-rookie:4:LEGACY_RANK",
    "legacy-superstar:2:LEGACY_RANK",
    "msl-2023-summer-champion-msc:2:ACCOLADE",
    "msl-2023-world-champion-msc:1:ACCOLADE",
    "msl-2024-world-champion-msbl:1:ACCOLADE",
    "season-titan-2-msbl:7:SEASON",
    "tournament-winner-msbl:2:TOURNAMENT",
    "tournament-winner-msc:2:TOURNAMENT",
    "wfc-200-0-season-world-record:223:MANUAL",
    "wfc-5012-daily-points-world-record:17:MANUAL",
    "wfc-66-0-daily-world-record:223:MANUAL",
    "wfc-final-daily-leader:223:MANUAL",
  ]);
  const byCode = new Map(plan.grants.map((grant) => [`${grant.titleCode}:${grant.playerId}`, grant.sourceRef]));
  assert.equal(byCode.get("msl-2023-world-champion-msc:1"), "Tournament:1 MSL 2023 World Championship");
  assert.equal(byCode.get("tournament-winner-msc:2"), "Tournaments:5 (1 non-MSL tournament win in MSC)");
  assert.equal(byCode.get("legacy-superstar:2"), "PlayerStats:MSBL 2v2 rank 8");
  assert.equal(byCode.get("season-titan-2-msbl:7"), "CompetitiveSeason:2 Burst Season 2026");
  assert.equal(byCode.get("wfc-final-daily-leader:223"), "Fixed: player 223, Discord 195905866527014912");
  assert.deepEqual(
    plan.newTitles.map((title) => [title.code, title.name, title.ruleKind, title.gameCode, title.ruleParams]),
    [
      [
        "msl-2023-world-champion-msc",
        "MSL 2023 WORLD CHAMPION",
        "tournament-name",
        "MSC",
        '{"names":["MSL 2023 World Championship"]}',
      ],
      [
        "msl-2024-world-champion-msbl",
        "MSL 2024 WORLD CHAMPION",
        "tournament-name",
        "MSBL",
        '{"names":["MSL 2024 World Championship"]}',
      ],
      [
        "msl-2023-summer-champion-msc",
        "MSL 2023 SUMMER CHAMPION",
        "tournament-name",
        "MSC",
        '{"names":["MSL 2023 Summer Split - Premier Event"]}',
      ],
      ["season-titan-2-msbl", "BURST 2026 STRIKERS TITAN", "season-titan", "MSBL", '{"season_id":2}'],
    ],
  );
  const variant = plan.newTitles.find((title) => title.code === "msl-2023-world-champion-msc");
  assert.equal(variant?.category, "msl");
  assert.equal(variant.sortOrder, CATALOG.find((title) => title.code === "msl-2023-world-champion")?.sortOrder);
});

test("wins count only in their own game, never added up across games", () => {
  const plan = planTitleAwards(
    sources({
      tournaments: [
        // Player 1: two World Championships in two games; player 3: two in SMS.
        tournament("MSL 2023 World Championship", "1"),
        tournament("MSL 2024 World Championship", "1", { gameType: 3 }),
        tournament("MSL 2022 World Championship", "3", { gameType: 2 }),
        tournament("MSL 2025 World Championship", "3", { gameType: 2 }),
        // Player 2 (like Romomo): four MSBL wins and one SMS win.
        ...[1, 2, 3, 4].map((n) => tournament(`MSBL Cup #${String(n)}`, "2", { gameType: 3 })),
        tournament("SMS Cup", "2", { gameType: 2 }),
        // Player 4: five MSC wins.
        ...[1, 2, 3, 4, 5].map((n) => tournament(`MSC Weekly #${String(n)}`, "4")),
      ],
      legacyRanks: undefined,
    }),
  );
  const granted = describe(plan).filter((grant) => /^(?:msl-\d-time|tournament-winner)/.test(grant));
  assert.deepEqual(granted.sort(), [
    "msl-2-time-world-champion-sms:3:ACCOLADE",
    "tournament-winner-green-msc:4:TOURNAMENT",
    "tournament-winner-msbl:2:TOURNAMENT",
    "tournament-winner-msc:4:TOURNAMENT",
    "tournament-winner-sms:2:TOURNAMENT",
  ]);
  const wins = countedWins(sources());
  assert.deepEqual(
    wins.side.get(2)?.map((won) => won.gameType),
    [1, 3, 1, 1, 1],
  );
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
    "Title msl-2025-spring-champion: no tournament named yet, so MSL 2025 SPRING CHAMPION waits for staff.",
  ];
  for (const text of expected) assert.ok(openPoints.includes(text), text);
  assert.ok(!openPoints.some((text) => text.includes("Gauntlet")), "MSL side events are no tournament wins at all");
  assert.ok(!openPoints.some((text) => text.includes("Gamblers Anon")), "an unfinished tournament is no open point");
});

test("a fixed title goes only to its player, and only while the Discord account matches", () => {
  const moved = planTitleAwards(
    sources({
      discordIds: new Map([
        [GOLDCOBRA.player_id, "1"],
        [GIANT.player_id, GIANT.discord_id],
      ]),
    }),
  );
  assert.ok(!moved.grants.some((grant) => grant.playerId === GOLDCOBRA.player_id));
  assert.ok(describe(moved).includes("wfc-5012-daily-points-world-record:17:MANUAL"));
  assert.ok(
    moved.openPoints.includes(
      "Title wfc-200-0-season-world-record: player 223 is not Discord account 195905866527014912 (it has 1), so it awards nothing.",
    ),
  );
  const gone = planTitleAwards(sources({ playerIds: new Set([1, 2]) }));
  assert.ok(!gone.grants.some((grant) => grant.sourceType === "MANUAL"));
  assert.ok(
    gone.openPoints.some(
      (text) => text.includes("player 17 is not Discord account") && text.includes("no such player"),
    ),
  );
  // WFC FINAL SEASON LEADER has no owner yet: staff only.
  assert.ok(!describe(planTitleAwards(sources())).some((grant) => grant.startsWith("wfc-final-season-leader:")));
});

test("a second run over its own result awards and creates nothing new", () => {
  const first = planTitleAwards(sources());
  const catalog = [...CATALOG, ...first.newTitles.map((title, index) => created(title, 1000 + index))];
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
  const variant = created(
    {
      code: "msl-2023-world-champion-msc",
      name: "MSL 2023 WORLD CHAMPION",
      category: "msl",
      sortOrder: 7,
      ruleKind: "tournament-name",
      ruleParams: '{"names":["MSL 2023 World Championship"]}',
      gameCode: "MSC",
    },
    900,
  );
  const plan = planTitleAwards(sources({ catalog: [...CATALOG, variant], unlocks: [{ playerId: 1, titleId: 900 }] }));
  assert.ok(!describe(plan).includes("msl-2023-world-champion-msc:1:ACCOLADE"));
  assert.ok(!plan.newTitles.some((title) => title.code === "msl-2023-world-champion-msc"));
  assert.ok(describe(plan).includes("msl-2024-world-champion-msbl:1:ACCOLADE"));
});

test("the daily run leaves the legacy ranks out; season titles wait for the season's end", () => {
  const plan = planTitleAwards(sources({ legacyRanks: undefined }));
  assert.ok(!plan.grants.some((grant) => grant.sourceType === "LEGACY_RANK"));
  assert.ok(!plan.grants.some((grant) => grant.playerId === 8), "Dusk 2026 is still running");
});

test("templates and retired titles award nothing themselves; a retired variant stops its awards", () => {
  const retiredVariant = {
    ...created(
      {
        code: "msl-2024-world-champion-msbl",
        name: "MSL 2024 WORLD CHAMPION",
        category: "msl",
        sortOrder: 8,
        ruleKind: "tournament-name",
        ruleParams: '{"names":["MSL 2024 World Championship"]}',
        gameCode: "MSBL",
      },
      901,
    ),
    isActive: false,
  };
  const plan = planTitleAwards(sources({ catalog: [...CATALOG, retiredVariant] }));
  const granted = describe(plan);
  assert.ok(!granted.some((grant) => grant.startsWith("msl-2024-world-champion")));
  assert.ok(!plan.newTitles.some((title) => title.code === "msl-2024-world-champion-msbl"));
  for (const code of [
    "msl-2023-world-champion",
    "tournament-winner",
    "tournament-winner-green",
    "msl-2-time-world-champion",
  ]) {
    assert.ok(!granted.some((grant) => grant.startsWith(`${code}:`)), code);
  }
});

test("inactive titles, unknown rule kinds and broken parameters award nothing", () => {
  const catalog = CATALOG.map((title) => {
    if (title.code === "msl-2023-world-champion") return { ...title, isActive: false };
    if (title.code === "msl-2024-world-champion") return { ...title, ruleKind: "best-goals" };
    if (title.code === "tournament-winner-msc") return { ...title, ruleParams: "{min:1" };
    return title;
  });
  const plan = planTitleAwards(sources({ catalog }));
  const granted = describe(plan);
  assert.ok(!granted.some((grant) => /^msl-202[34]-world-champion/.test(grant)));
  assert.ok(!granted.some((grant) => grant.startsWith("tournament-winner-msc:")));
  assert.ok(granted.includes("tournament-winner-msbl:2:TOURNAMENT"), "the other games are not affected");
  assert.ok(
    plan.openPoints.includes('Title msl-2024-world-champion: unknown rule kind "best-goals", so it awards nothing.'),
  );
  assert.ok(
    plan.openPoints.includes("Title tournament-winner-msc: RuleParams is no JSON object, so it awards nothing."),
  );
});

test("season titles are made per game; a staff title without a game is used, a retired one stops the awards", () => {
  const titans = [
    { seasonId: 2, playerId: 7, gameType: 3 },
    { seasonId: 2, playerId: 6, gameType: 1 },
    { seasonId: 2, playerId: 7, gameType: 1 },
  ];
  const perGame = planTitleAwards(sources({ titans }));
  assert.deepEqual(
    perGame.newTitles.filter((title) => title.ruleKind === "season-titan").map((title) => title.code),
    ["season-titan-2-msc", "season-titan-2-msbl"],
  );
  assert.deepEqual(
    perGame.grants
      .filter((grant) => grant.sourceType === "SEASON")
      .map((grant) => `${grant.titleCode}:${grant.playerId}`),
    ["season-titan-2-msc:6", "season-titan-2-msc:7", "season-titan-2-msbl:7"],
  );

  const staffTitle = seasonTitle({
    id: 500,
    code: "burst-titan",
    name: "BURST 2026 STRIKERS TITAN",
    ruleParams: '{"season_id":2}',
  });
  const used = planTitleAwards(sources({ catalog: [...CATALOG, staffTitle] }));
  assert.ok(!used.newTitles.some((title) => title.ruleKind === "season-titan"));
  assert.ok(describe(used).includes("burst-titan:7:SEASON"));
  const retired = planTitleAwards(sources({ catalog: [...CATALOG, { ...staffTitle, isActive: false }] }));
  assert.ok(!retired.grants.some((grant) => grant.sourceType === "SEASON"));

  const preCreated = seasonTitle({
    id: 501,
    code: "season-titan-2-msbl",
    name: "BURST 2026 STRIKERS TITAN",
    ruleParams: '{"season_id":2}',
    gameCode: "MSBL",
  });
  const ready = planTitleAwards(sources({ catalog: [...CATALOG, preCreated] }));
  assert.ok(!ready.newTitles.some((title) => title.ruleKind === "season-titan"));
  assert.ok(describe(ready).includes("season-titan-2-msbl:7:SEASON"));
  assert.ok(
    !describe(planTitleAwards(sources({ titans: [], catalog: [...CATALOG, preCreated] }))).some((g) =>
      g.includes("titan"),
    ),
  );
});

test("an unknown game awards no variant and is reported", () => {
  nextTournament = 1;
  const plan = planTitleAwards(
    sources({
      tournaments: [tournament("MSL 2023 World Championship", "1", { gameType: 0 })],
      titans: [{ seasonId: 2, playerId: 7, gameType: 9 }],
      legacyRanks: undefined,
    }),
  );
  assert.ok(!plan.grants.some((grant) => grant.sourceType === "ACCOLADE" || grant.sourceType === "SEASON"));
  assert.ok(
    plan.openPoints.includes(
      'Tournament 1 "MSL 2023 World Championship" (game 0): not one game, so it awards MSL 2023 WORLD CHAMPION to nobody until staff decide.',
    ),
  );
  assert.ok(plan.openPoints.includes("Season 2: Strikers Titan 7 in game 9 is in no known game."));
  assert.equal(id("msl-2023-world-champion") > 0, true);
});
