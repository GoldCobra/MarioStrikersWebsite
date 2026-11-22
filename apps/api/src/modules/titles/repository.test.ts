import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDatabase, type RecordedStatement } from "../../test-support/fake-database.ts";
import { TITLE_CATALOG, TITLE_CATEGORIES } from "./catalog.ts";
import {
  createTitleCatalog,
  fetchTitleCodes,
  insertMissingCategories,
  insertMissingTitles,
  readLastSyncRun,
  readTitleSources,
  toLegacyRankRows,
  writeTitleAwards,
} from "./repository.ts";
import type { TitleAwardPlan } from "./rules.ts";

/** A statement's text on one line, so that it can be matched across its line breaks. */
const flat = (text: string | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();

/** The parameter values of the recorded INSERTs into `table`, `width` per row, in order. */
function insertedValues(statements: readonly RecordedStatement[], table: string, width: number): unknown[][] {
  const values = statements
    .filter((statement) => statement.text.includes(`INSERT INTO ${table} (`))
    .flatMap((statement) => statement.values);
  return Array.from({ length: values.length / width }, (_, index) => values.slice(index * width, (index + 1) * width));
}

test("the seed adds only missing categories and titles, every value a parameter", async () => {
  // Every row counts as missing: SELECT @@ROWCOUNT answers with the rows of its INSERT.
  const database = createFakeDatabase(({ text, values }) => {
    if (text.includes("INSERT INTO dbo.PlayerTitleCategory (")) return [{ inserted: values.length / 5 }];
    if (text.includes("INSERT INTO dbo.PlayerTitle (")) return [{ inserted: values.length / 11 }];
    return [{ Code: "og-player" }, { Code: "npc" }];
  });
  assert.equal(await insertMissingCategories(database, TITLE_CATEGORIES), TITLE_CATEGORIES.length);
  assert.equal(await insertMissingTitles(database, TITLE_CATALOG), TITLE_CATALOG.length);

  const [categorySql, ...titleSqls] = database.statements;
  assert.match(
    flat(categorySql?.text),
    /WHERE NOT EXISTS \(SELECT 1 FROM dbo\.PlayerTitleCategory c WHERE c\.Code = v\.Code\); SELECT @@ROWCOUNT AS inserted;$/,
  );
  assert.deepEqual(insertedValues(database.statements, "dbo.PlayerTitleCategory", 5)[6], [
    "free",
    "Free Titles",
    "Everyone",
    true,
    6,
  ]);

  assert.ok(titleSqls.length);
  for (const statement of titleSqls) {
    const text = flat(statement.text);
    assert.match(
      text,
      /WHERE NOT EXISTS \(SELECT 1 FROM dbo\.PlayerTitle t WHERE t\.Code = v\.Code\); SELECT @@ROWCOUNT AS inserted;$/,
    );
    assert.doesNotMatch(text, /CAN'T|KRITTER|"FOOTBALL"/);
    // 11 parameters per title stay far below SQL Server's 2100 per request.
    assert.ok(statement.values.length < 2100);
  }
  // A title's values in column order: Code, Name, CategoryCode, SortOrder, RuleKind, RuleParams, StyleKey,
  // ExclusiveGroup, ExclusiveLevel, GameCode, IsActive.
  const titles = insertedValues(database.statements, "dbo.PlayerTitle", 11);
  const title = (code: string): unknown[] => titles.find((values) => values[0] === code) ?? [];
  assert.equal(title("tournament-winner-green")[1], "TOURNAMENT WINNER");
  assert.deepEqual(title("tournament-winner-green").slice(5), ['{"min":5}', "green", null, null, null, false]);
  assert.deepEqual(title("tournament-winner-green-sms").slice(9), ["SMS", true]);
  assert.deepEqual(title("legacy-legend").slice(7, 9), ["legacy-rank", 4]);
  assert.equal(title("og-player")[5], null);

  // ops:player-titles checks the catalog against the stored codes.
  assert.deepEqual([...(await fetchTitleCodes(database))], ["og-player", "npc"]);
  assert.equal(flat(database.statements.at(-1)?.text), "SELECT Code FROM dbo.PlayerTitle;");
});

test("the catalog is read once per five minutes, again after invalidate and after a failure", async () => {
  let fail = false;
  const database = createFakeDatabase(() => {
    if (fail) throw new Error("Connection is closed.");
    return [
      {
        Id: 3,
        Code: "og-player",
        Name: "OG PLAYER ",
        CategoryCode: "free",
        SortOrder: 12,
        RuleKind: "everyone",
        RuleParams: null,
        StyleKey: null,
        ExclusiveGroup: null,
        ExclusiveLevel: null,
        GameCode: null,
        IsActive: true,
        CategoryName: "Free Titles",
        CategorySort: 6,
        IsGlobal: 1,
      },
    ];
  });
  const catalog = createTitleCatalog(database);
  const [title] = await catalog.get();
  assert.deepEqual(title, {
    id: 3,
    code: "og-player",
    name: "OG PLAYER",
    category: "free",
    categoryName: "Free Titles",
    categorySort: 6,
    isGlobal: true,
    sortOrder: 12,
    ruleKind: "everyone",
    ruleParams: "",
    styleKey: "",
    exclusiveGroup: "",
    exclusiveLevel: 0,
    gameCode: "",
    isActive: true,
  });
  await catalog.get();
  assert.equal(database.statements.length, 1);
  assert.match(
    flat(database.statements[0]?.text),
    /^SELECT t\.Id, t\.Code, t\.Name, .*, c\.IsGlobal FROM dbo\.PlayerTitle t INNER JOIN dbo\.PlayerTitleCategory c ON c\.Code = t\.CategoryCode;$/,
  );
  catalog.invalidate();
  fail = true;
  await assert.rejects(catalog.get(), /Connection is closed/);
  fail = false;
  await catalog.get();
  assert.equal(database.statements.length, 3);
});

test("the sources are read in one batch; the legacy ranks only when asked for", async () => {
  const database = createFakeDatabase(({ text }) =>
    text.includes("DECLARE @cutoff")
      ? [{ Player: 4, GameType: 3, Rank: 7, Rank2v2: 2, Singles: 31, Teams: 3 }]
      : {
          sets: [
            [],
            [{ PlayerId: 4, TitleId: 9 }],
            [{ ID: 4, DiscordID: " 195905866527014912 " }],
            [
              {
                ID: 211,
                Name: " MSL 2023 World Championship ",
                GameType: 1,
                IsComplete: true,
                Winner: "9",
                TournamentStartDate: new Date("2023-12-06T00:00:00Z"),
              },
            ],
            [{ Id: 2, SeasonNumber: 1, DisplayName: "Burst Season 2026", LifecycleStatus: "completed" }],
            [{ SeasonId: 2, PlayerId: 4, GameId: 3 }],
          ],
        },
  );
  const daily = await readTitleSources(database, { legacy: false });
  assert.equal(database.statements.length, 1);
  const [batch] = database.statements;
  assert.match(flat(batch?.text), /FROM rocci121_toby\.CompetitiveSeasonRewardEarned e WHERE e\.TierOrder = @p0;$/);
  assert.deepEqual(batch?.values, [7]);
  assert.equal(daily.legacyRanks, undefined);
  assert.deepEqual(daily.tournaments, [
    {
      id: 211,
      name: "MSL 2023 World Championship",
      gameType: 1,
      isComplete: true,
      winner: "9",
      startDate: "2023-12-06",
    },
  ]);
  assert.deepEqual(daily.seasons, [{ id: 2, seasonNumber: 1, displayName: "Burst Season 2026", status: "completed" }]);
  assert.deepEqual(daily.unlocks, [{ playerId: 4, titleId: 9 }]);
  assert.deepEqual([...daily.playerIds], [4]);
  assert.deepEqual([...daily.discordIds], [[4, "195905866527014912"]]);
  assert.deepEqual(daily.titans, [{ seasonId: 2, playerId: 4, gameType: 3 }]);

  const full = await readTitleSources(database, { legacy: true });
  assert.deepEqual(full.legacyRanks, [
    { playerId: 4, gameType: 3, mode: "1v1", rank: 7, matchesBefore: 31 },
    { playerId: 4, gameType: 3, mode: "2v2", rank: 2, matchesBefore: 3 },
  ]);
  assert.deepEqual(toLegacyRankRows({ Player: 0, Rank: 5 }), []);
});

test("the last run comes from the newest WebsiteTitleSync row", async () => {
  const at = new Date("2026-10-02T04:00:00Z");
  const logged = createFakeDatabase(() => [{ TimeOfCommand: at }]);
  assert.deepEqual(await readLastSyncRun(logged), at);
  const [read] = logged.statements;
  assert.match(
    flat(read?.text),
    /^SELECT TOP 1 TimeOfCommand FROM dbo\.CommandLog WHERE Command = @p0 ORDER BY Id DESC;$/,
  );
  assert.deepEqual(read?.values, ["WebsiteTitleSync"]);
  assert.equal(await readLastSyncRun(createFakeDatabase(() => [])), null);
});

const PLAN: TitleAwardPlan = {
  newTitles: [
    {
      code: "season-titan-2",
      name: "BURST 2026 STRIKERS TITAN",
      category: "competitive-season",
      sortOrder: 1,
      ruleKind: "season-titan",
      ruleParams: '{"season_id":2}',
      gameCode: "MSBL",
    },
  ],
  grants: Array.from({ length: 450 }, (_, index) => ({
    playerId: index + 1,
    titleCode: index ? "legacy-rookie" : "season-titan-2",
    sourceType: index ? "LEGACY_RANK" : "SEASON",
    sourceRef: `ref ${index}`,
  })),
  openPoints: [],
};

/** The grants of a recorded INSERT: GrantedBy comes once, then four values per grant. */
const grantCount = (statement: RecordedStatement): number => (statement.values.length - 1) / 4;

test("grants are written in chunks in one transaction with the run in dbo.CommandLog", async () => {
  const database = createFakeDatabase((statement) =>
    statement.text.includes("INSERT INTO dbo.PlayerTitleUnlock") ? [{ inserted: grantCount(statement) }] : undefined,
  );
  const inserted = await writeTitleAwards(database, PLAN, { grantedBy: "ops:title-sync", log: { granted: 450 } });
  assert.equal(inserted, 450);
  assert.deepEqual(database.transactions, ["begin", "commit"]);
  const [newTitle, ...rest] = database.statements;
  assert.match(
    flat(newTitle?.text),
    /^IF NOT EXISTS \(SELECT 1 FROM dbo\.PlayerTitle WHERE Code = @p0\) INSERT INTO dbo\.PlayerTitle /,
  );
  assert.deepEqual(newTitle?.values, [
    "season-titan-2",
    "season-titan-2",
    "BURST 2026 STRIKERS TITAN",
    "competitive-season",
    1,
    "season-titan",
    '{"season_id":2}',
    "MSBL",
  ]);
  const grants = rest.filter((statement) => statement.text.includes("PlayerTitleUnlock"));
  assert.deepEqual(grants.map(grantCount), [200, 200, 50]);
  const [firstGrant] = grants;
  assert.ok(firstGrant);
  assert.deepEqual(firstGrant.values.slice(0, 5), ["ops:title-sync", 1, "season-titan-2", "SEASON", "ref 0"]);
  assert.match(
    flat(firstGrant.text),
    /WHERE NOT EXISTS \(SELECT 1 FROM dbo\.PlayerTitleUnlock u WHERE u\.PlayerId = v\.PlayerId AND u\.TitleId = t\.Id\); SELECT @@ROWCOUNT AS inserted;$/,
  );
  const log = rest.at(-1);
  assert.match(flat(log?.text), /^INSERT INTO dbo\.CommandLog \(Command, Parameters\) VALUES \(@p0, @p1\);$/);
  assert.equal(log?.values[0], "WebsiteTitleSync");
  assert.deepEqual(JSON.parse(String(log.values[1])), { granted_by: "ops:title-sync", granted: 450 });
});

test("fewer inserted rows than planned roll the whole run back", async () => {
  const database = createFakeDatabase(({ text }) =>
    text.includes("INSERT INTO dbo.PlayerTitleUnlock") ? [{ inserted: 1 }] : undefined,
  );
  await assert.rejects(
    writeTitleAwards(database, PLAN, { grantedBy: "website title sync", log: {} }),
    /Planned 450 title unlocks but inserted 3; nothing was saved\./,
  );
  assert.deepEqual(database.transactions, ["begin", "rollback"]);
  assert.ok(!database.statements.some((statement) => statement.text.includes("CommandLog")));
});
