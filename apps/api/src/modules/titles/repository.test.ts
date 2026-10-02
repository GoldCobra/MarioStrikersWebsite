import assert from "node:assert/strict";
import test from "node:test";
import type { mssql } from "../../db/database.ts";
import { createFakeDatabase } from "../../test-support/fake-database.ts";
import { TITLE_CATALOG, TITLE_CATEGORIES } from "./catalog.ts";
import {
  CATALOG_QUERY,
  GAME_COLUMN_SQL,
  LAST_SYNC_QUERY,
  SCHEMA_SQL,
  buildGrantQuery,
  buildSeedCategoriesQuery,
  buildSeedTitlesQuery,
  createTitleCatalog,
  readLastSyncRun,
  readTitleSources,
  toLegacyRankRows,
  writeTitleAwards,
} from "./repository.ts";
import type { TitleAwardPlan } from "./rules.ts";

function recordingRequest(): { request: mssql.Request; inputs: Record<string, unknown> } {
  const inputs: Record<string, unknown> = {};
  const request = {
    input(name: string, _type: unknown, value: unknown) {
      inputs[name] = value;
      return request;
    },
  } as unknown as mssql.Request;
  return { request, inputs };
}

test("the schema creates each title table only when it is missing", () => {
  for (const table of [
    "PlayerTitleCategory",
    "PlayerTitle",
    "PlayerTitleUnlock",
    "PlayerActiveTitle",
    "PlayerTitleTestUnlock",
  ]) {
    assert.match(
      SCHEMA_SQL,
      new RegExp(`IF OBJECT_ID\\(N'dbo\\.${table}', N'U'\\) IS NULL CREATE TABLE dbo\\.${table} \\(`),
    );
  }
  assert.doesNotMatch(SCHEMA_SQL, /\b(?:DROP|ALTER|TRUNCATE|DELETE)\b/i);
  // FULL CAPS is checked byte by byte: the database's collation ignores case.
  assert.match(SCHEMA_SQL, /CHECK \(Name = UPPER\(Name\) COLLATE Latin1_General_100_BIN2/);
  assert.match(SCHEMA_SQL, /CONSTRAINT UQ_PlayerTitleUnlock_Player_Title UNIQUE \(PlayerId, TitleId\)/);
  assert.match(SCHEMA_SQL, /SourceType IN \('SEASON', 'ACCOLADE', 'TOURNAMENT', 'LEGACY_RANK', 'MANUAL'\)/);
  // A title's game is one of the three, or none; test unlocks are their own table, once per player and title.
  assert.match(
    SCHEMA_SQL,
    /GameCode VARCHAR\(8\) NULL CONSTRAINT CK_PlayerTitle_GameCode CHECK \(GameCode IN \('MSBL', 'MSC', 'SMS'\)\)/,
  );
  assert.match(SCHEMA_SQL, /CONSTRAINT UQ_PlayerTitleTestUnlock_Player_Title UNIQUE \(PlayerId, TitleId\)/);
  assert.match(SCHEMA_SQL, /FK_PlayerTitleTestUnlock_Title REFERENCES dbo\.PlayerTitle \(Id\)/);
});

test("an older PlayerTitle gets the GameCode column only when it is missing, and nothing else", () => {
  assert.match(
    GAME_COLUMN_SQL,
    /^IF COL_LENGTH\(N'dbo\.PlayerTitle', N'GameCode'\) IS NULL ALTER TABLE dbo\.PlayerTitle ADD GameCode /,
  );
  assert.doesNotMatch(GAME_COLUMN_SQL, /\b(?:DROP|TRUNCATE|DELETE|UPDATE)\b/i);
});

test("the seed adds only missing categories and titles, every value a typed parameter", () => {
  const categories = recordingRequest();
  const categorySql = buildSeedCategoriesQuery(TITLE_CATEGORIES, categories.request);
  assert.match(categorySql, /WHERE NOT EXISTS \(SELECT 1 FROM dbo\.PlayerTitleCategory c WHERE c\.Code = v\.Code\);/);
  assert.equal(categories.inputs.cCode5, "free");
  assert.equal(categories.inputs.cGlobal5, true);

  const titles = recordingRequest();
  const titleSql = buildSeedTitlesQuery(TITLE_CATALOG, titles.request);
  assert.match(titleSql, /WHERE NOT EXISTS \(SELECT 1 FROM dbo\.PlayerTitle t WHERE t\.Code = v\.Code\);/);
  assert.match(titleSql, /SELECT @@ROWCOUNT AS inserted;$/);
  assert.doesNotMatch(titleSql, /CAN'T|KRITTER|"FOOTBALL"/);
  const index = TITLE_CATALOG.findIndex((title) => title.code === "tournament-winner-green");
  assert.equal(titles.inputs[`tName${index}`], "TOURNAMENT WINNER");
  assert.equal(titles.inputs[`tParams${index}`], '{"min":5}');
  assert.equal(titles.inputs[`tStyle${index}`], "green");
  assert.equal(titles.inputs[`tGroup${index}`], null);
  assert.equal(titles.inputs[`tActive${index}`], false);
  assert.equal(titles.inputs[`tGame${index}`], null);
  const variant = TITLE_CATALOG.findIndex((title) => title.code === "tournament-winner-green-sms");
  assert.equal(titles.inputs[`tGame${variant}`], "SMS");
  assert.equal(titles.inputs[`tActive${variant}`], true);
  const legacy = TITLE_CATALOG.findIndex((title) => title.code === "legacy-legend");
  assert.equal(titles.inputs[`tGroup${legacy}`], "legacy-rank");
  assert.equal(titles.inputs[`tLevel${legacy}`], 4);
  const free = TITLE_CATALOG.findIndex((title) => title.code === "og-player");
  assert.equal(titles.inputs[`tParams${free}`], null);
  // 11 parameters per title stay far below SQL Server's 2100 per request.
  assert.ok(Object.keys(titles.inputs).length < 2100);
});

test("the catalog is read once per five minutes, again after invalidate and after a failure", async () => {
  let fail = false;
  const database = createFakeDatabase(() => {
    if (fail) throw new Error("Connection is closed.");
    return {
      recordset: [
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
      ],
    };
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
  assert.equal(database.queries.length, 1);
  assert.equal(database.queries[0]?.sql, CATALOG_QUERY);
  catalog.invalidate();
  fail = true;
  await assert.rejects(catalog.get(), /Connection is closed/);
  fail = false;
  await catalog.get();
  assert.equal(database.queries.length, 3);
});

test("the sources are read in one batch; the legacy ranks only when asked for", async () => {
  const database = createFakeDatabase((sql) =>
    sql.includes("DECLARE @cutoff")
      ? { recordset: [{ Player: 4, GameType: 3, Rank: 7, Rank2v2: 2, Singles: 31, Teams: 3 }] }
      : {
          recordsets: [
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
  assert.equal(database.queries.length, 1);
  assert.match(database.queries[0]?.sql ?? "", /CompetitiveSeasonRewardEarned e WHERE e\.TierOrder = 7;$/);
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
  const logged = createFakeDatabase(() => ({ recordset: [{ TimeOfCommand: at }] }));
  assert.deepEqual(await readLastSyncRun(logged), at);
  assert.equal(logged.queries[0]?.sql, LAST_SYNC_QUERY);
  assert.match(LAST_SYNC_QUERY, /WHERE Command = N'WebsiteTitleSync' ORDER BY Id DESC;$/);
  assert.equal(await readLastSyncRun(createFakeDatabase(() => ({ recordset: [] }))), null);
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

test("grants are written in chunks in one transaction with the run in dbo.CommandLog", async () => {
  const database = createFakeDatabase((sql, inputs) => {
    if (!sql.includes("INSERT INTO dbo.PlayerTitleUnlock")) return { recordset: [] };
    return { recordset: [{ inserted: Object.keys(inputs).filter((name) => name.startsWith("player")).length }] };
  });
  const inserted = await writeTitleAwards(database, PLAN, { grantedBy: "ops:title-sync", log: { granted: 450 } });
  assert.equal(inserted, 450);
  assert.deepEqual(database.transactions, ["begin", "commit"]);
  const [newTitle, ...rest] = database.queries;
  assert.match(newTitle?.sql ?? "", /^IF NOT EXISTS \(SELECT 1 FROM dbo\.PlayerTitle WHERE Code = @code\) INSERT/);
  assert.equal(newTitle?.inputs.name, "BURST 2026 STRIKERS TITAN");
  assert.equal(newTitle.inputs.gameCode, "MSBL");
  const grants = rest.filter((query) => query.sql.includes("PlayerTitleUnlock"));
  assert.deepEqual(
    grants.map((query) => Object.keys(query.inputs).filter((name) => name.startsWith("player")).length),
    [200, 200, 50],
  );
  const [firstGrant] = grants;
  assert.ok(firstGrant);
  assert.equal(firstGrant.inputs.grantedBy, "ops:title-sync");
  assert.equal(firstGrant.inputs.code0, "season-titan-2");
  const log = rest.at(-1);
  assert.match(
    log?.sql ?? "",
    /INSERT INTO dbo\.CommandLog \(Command, Parameters\) VALUES \(N'WebsiteTitleSync', @log\);/,
  );
  assert.deepEqual(JSON.parse(String(log?.inputs.log)), { granted_by: "ops:title-sync", granted: 450 });
  assert.match(
    buildGrantQuery(1),
    /WHERE NOT EXISTS \(SELECT 1 FROM dbo\.PlayerTitleUnlock u WHERE u\.PlayerId = v\.PlayerId AND u\.TitleId = t\.Id\);/,
  );
});

test("fewer inserted rows than planned roll the whole run back", async () => {
  const database = createFakeDatabase((sql) => ({
    recordset: sql.includes("INSERT INTO dbo.PlayerTitleUnlock") ? [{ inserted: 1 }] : [],
  }));
  await assert.rejects(
    writeTitleAwards(database, PLAN, { grantedBy: "website title sync", log: {} }),
    /Planned 450 title unlocks but inserted 3; nothing was saved\./,
  );
  assert.deepEqual(database.transactions, ["begin", "rollback"]);
  assert.ok(!database.queries.some((query) => query.sql.includes("CommandLog")));
});
