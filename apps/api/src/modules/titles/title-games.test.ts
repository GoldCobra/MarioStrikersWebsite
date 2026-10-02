import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDatabase, type QueryHandler } from "../../test-support/fake-database.ts";
import { GIANT, GOLDCOBRA, TITLE_CATALOG, TITLE_CATEGORIES, seededCatalog } from "./catalog.ts";
import { TITLE_GAMES } from "./games.ts";
import {
  EXPECTED_CHANGES,
  SCHEMA_STATE_QUERY,
  TITLE_GAMES_BACKUPS,
  applyTitleGames,
  applyTitleGamesSchema,
  expectedVariants,
  plannedRowChanges,
  replacements,
  sourceTournamentIds,
  variantBase,
} from "./title-games.ts";

type Row = Record<string, unknown>;

interface TitleRow {
  Id: number;
  Code: string;
  Name: string;
  CategoryCode: string;
  SortOrder: number;
  RuleKind: string;
  RuleParams: string | null;
  StyleKey: string | null;
  ExclusiveGroup: string | null;
  ExclusiveLevel: number | null;
  GameCode: string | null;
  IsActive: boolean;
}

interface Tables {
  titles: TitleRow[];
  unlocks: { PlayerId: number; TitleId: number; SourceType: string; SourceRef: string }[];
  active: Map<number, number>;
  tests: { PlayerId: number; TitleId: number }[];
  backups: Set<string>;
  log: string[];
}

/** The 63 titles as #66/#67 left them in the database (no game, nothing fixed, no templates). */
function liveTitles(): TitleRow[] {
  return TITLE_CATALOG.filter((title) => !title.gameCode).map((title, index) => {
    const event = title.ruleKind === "msl-event";
    const names = (title.ruleParams?.names as string[] | undefined) ?? [];
    const manual = title.ruleKind === "fixed-players" || (event && !names.length);
    return {
      Id: index + 1,
      Code: title.code,
      Name: title.name,
      CategoryCode: title.category,
      SortOrder: title.sortOrder,
      RuleKind: manual ? "manual" : event ? "tournament-name" : title.ruleKind,
      RuleParams: manual || !title.ruleParams ? null : JSON.stringify(title.ruleParams),
      StyleKey: title.styleKey ?? null,
      ExclusiveGroup: title.exclusiveGroup ?? null,
      ExclusiveLevel: title.exclusiveLevel ?? null,
      GameCode: null,
      IsActive: true,
    };
  });
}

const PLAYERS = [
  { ID: 5, DiscordID: "5005" },
  { ID: 9, DiscordID: "9009" },
  { ID: 115, DiscordID: "115115" },
  { ID: GIANT.player_id, DiscordID: GIANT.discord_id },
  { ID: GOLDCOBRA.player_id, DiscordID: GOLDCOBRA.discord_id },
];

let nextId = 100;
const tournament = (name: string, gameType: number, winner: number, date: string): Row => ({
  ID: nextId++,
  Name: name,
  GameType: gameType,
  IsComplete: true,
  Winner: String(winner),
  TournamentStartDate: date,
});

function liveTournaments(): Row[] {
  nextId = 100;
  return [
    tournament("MSL 2022 World Championship", 1, 9, "2022-12-05"), // 100
    tournament("MSL 2023 World Championship", 1, 9, "2023-12-06"), // 101
    tournament("MSL 2023 Summer Split - Premier Event", 1, 9, "2023-07-01"), // 102
    ...[1, 2, 3, 4, 5].map((n) => tournament(`MSC Weekly #${String(n)}`, 1, 5, `2021-0${String(n)}-01`)), // 103-107
    ...[1, 2, 3, 4].map((n) => tournament(`MSBL Cup #${String(n)}`, 3, 115, `2023-0${String(n)}-01`)), // 108-111
    tournament("SMS Cup", 2, 115, "2023-05-01"), // 112
  ];
}

/** What the #66 sync wrote for that data (spielübergreifend counted). */
function liveUnlocks(titles: readonly TitleRow[]): Tables["unlocks"] {
  const id = (code: string): number => titles.find((title) => title.Code === code)?.Id ?? 0;
  return [
    {
      PlayerId: 9,
      TitleId: id("msl-2022-world-champion"),
      SourceType: "ACCOLADE",
      SourceRef: "Tournament:100 MSL 2022 World Championship",
    },
    {
      PlayerId: 9,
      TitleId: id("msl-2023-world-champion"),
      SourceType: "ACCOLADE",
      SourceRef: "Tournament:101 MSL 2023 World Championship",
    },
    {
      PlayerId: 9,
      TitleId: id("msl-2023-summer-champion"),
      SourceType: "ACCOLADE",
      SourceRef: "Tournament:102 MSL 2023 Summer Split - Premier Event",
    },
    {
      PlayerId: 9,
      TitleId: id("msl-2-time-world-champion"),
      SourceType: "ACCOLADE",
      SourceRef: "Tournaments:100,101 (2 MSL World Championships)",
    },
    {
      PlayerId: 5,
      TitleId: id("tournament-winner"),
      SourceType: "TOURNAMENT",
      SourceRef: "Tournaments:103 (1 non-MSL tournament win)",
    },
    {
      PlayerId: 5,
      TitleId: id("tournament-winner-green"),
      SourceType: "TOURNAMENT",
      SourceRef: "Tournaments:103,104,105,106,107 (5 non-MSL tournament wins)",
    },
    {
      PlayerId: 115,
      TitleId: id("tournament-winner"),
      SourceType: "TOURNAMENT",
      SourceRef: "Tournaments:108 (1 non-MSL tournament win)",
    },
    {
      PlayerId: 115,
      TitleId: id("tournament-winner-green"),
      SourceType: "TOURNAMENT",
      SourceRef: "Tournaments:108,109,110,111,112 (5 non-MSL tournament wins)",
    },
  ];
}

function liveTables(): Tables {
  const titles = liveTitles();
  const id = (code: string): number => titles.find((title) => title.Code === code)?.Id ?? 0;
  return {
    titles,
    unlocks: liveUnlocks(titles),
    active: new Map([
      [9, id("msl-2-time-world-champion")],
      [115, id("tournament-winner-green")],
      [GOLDCOBRA.player_id, id("three-ghosts")],
    ]),
    tests: [],
    backups: new Set(),
    log: [],
  };
}

/** Answers the migration's queries from `tables`, like the database would. */
function handlerFor(tables: Tables, options: { seasonStatus?: string } = {}): QueryHandler {
  const categories = new Map(TITLE_CATEGORIES.map((category) => [category.code, category]));
  const catalogRows = (): Row[] =>
    tables.titles.map((title) => {
      const category = categories.get(title.CategoryCode);
      return {
        ...title,
        CategoryName: category?.name,
        CategorySort: category?.sortOrder,
        IsGlobal: category?.isGlobal,
      };
    });
  const nextTitleId = (): number => Math.max(...tables.titles.map((title) => title.Id)) + 1;
  return (sql, inputs) => {
    if (sql.startsWith("SELECT Id, Code, RuleKind, RuleParams, IsActive, GameCode FROM dbo.PlayerTitle;")) {
      return { recordset: tables.titles };
    }
    if (sql.includes("FROM rocci121_toby.CompetitiveSeason s WHERE s.DisplayName = @name")) {
      return {
        recordset: [
          { Id: 2, SeasonNumber: 1, DisplayName: inputs.name, LifecycleStatus: options.seasonStatus ?? "completed" },
        ],
      };
    }
    if (sql.includes("FROM dbo.Tournament t;")) {
      return {
        recordsets: [
          catalogRows(),
          tables.unlocks.map(({ PlayerId, TitleId }) => ({ PlayerId, TitleId })),
          PLAYERS,
          liveTournaments(),
          [{ Id: 2, SeasonNumber: 1, DisplayName: "Burst Season 2026", LifecycleStatus: "completed" }],
          [],
        ],
      };
    }
    if (sql.includes("DECLARE @cutoff")) return { recordset: [] };
    if (sql.startsWith("SELECT PlayerId, TitleId FROM dbo.PlayerActiveTitle;")) {
      return { recordset: [...tables.active].map(([PlayerId, TitleId]) => ({ PlayerId, TitleId })) };
    }
    if (sql.startsWith("SELECT PlayerId, TitleId FROM dbo.PlayerTitleTestUnlock;")) return { recordset: tables.tests };
    if (sql.startsWith("SELECT OBJECT_ID(@name")) {
      return { recordset: [{ id: tables.backups.has(String(inputs.name)) ? 1 : null }] };
    }
    const backup = /^SELECT \* INTO (\S+) FROM/.exec(sql);
    if (backup?.[1]) {
      tables.backups.add(backup[1]);
      return { rowsAffected: [1] };
    }
    if (sql.startsWith("INSERT INTO dbo.PlayerTitle (Code, Name, CategoryCode")) {
      let inserted = 0;
      for (let index = 0; `tCode${String(index)}` in inputs; index += 1) {
        const at = (name: string): unknown => inputs[`${name}${String(index)}`];
        if (tables.titles.some((title) => title.Code === at("tCode"))) continue;
        tables.titles.push({
          Id: nextTitleId(),
          Code: String(at("tCode")),
          Name: String(at("tName")),
          CategoryCode: String(at("tCategory")),
          SortOrder: Number(at("tSort")),
          RuleKind: String(at("tKind")),
          RuleParams: (at("tParams") as string | null) ?? null,
          StyleKey: (at("tStyle") as string | null) ?? null,
          ExclusiveGroup: (at("tGroup") as string | null) ?? null,
          ExclusiveLevel: (at("tLevel") as number | null) ?? null,
          GameCode: (at("tGame") as string | null) ?? null,
          IsActive: at("tActive") !== false,
        });
        inserted += 1;
      }
      return { recordset: [{ inserted }] };
    }
    if (sql.startsWith("UPDATE dbo.PlayerTitle SET RuleKind")) {
      const title = tables.titles.find((row) => row.Code === inputs.code);
      if (!title) return { rowsAffected: [0] };
      title.RuleKind = String(inputs.ruleKind);
      title.RuleParams = (inputs.ruleParams as string | null) ?? null;
      title.IsActive = inputs.isActive === true;
      return { rowsAffected: [1] };
    }
    if (sql.startsWith("IF NOT EXISTS (SELECT 1 FROM dbo.PlayerTitle WHERE Code = @code)")) {
      if (!tables.titles.some((title) => title.Code === inputs.code)) {
        tables.titles.push({
          Id: nextTitleId(),
          Code: String(inputs.code),
          Name: String(inputs.name),
          CategoryCode: String(inputs.category),
          SortOrder: Number(inputs.sortOrder),
          RuleKind: String(inputs.ruleKind),
          RuleParams: String(inputs.ruleParams),
          StyleKey: null,
          ExclusiveGroup: null,
          ExclusiveLevel: null,
          GameCode: (inputs.gameCode as string | null) ?? null,
          IsActive: true,
        });
      }
      return { recordset: [] };
    }
    if (sql.startsWith("INSERT INTO dbo.PlayerTitleUnlock")) {
      let inserted = 0;
      for (let index = 0; `player${String(index)}` in inputs; index += 1) {
        const playerId = Number(inputs[`player${String(index)}`]);
        const title = tables.titles.find((row) => row.Code === inputs[`code${String(index)}`]);
        if (!title || tables.unlocks.some((u) => u.PlayerId === playerId && u.TitleId === title.Id)) continue;
        tables.unlocks.push({
          PlayerId: playerId,
          TitleId: title.Id,
          SourceType: String(inputs[`source${String(index)}`]),
          SourceRef: String(inputs[`ref${String(index)}`]),
        });
        inserted += 1;
      }
      return { recordset: [{ inserted }] };
    }
    if (sql.startsWith("INSERT INTO dbo.CommandLog")) {
      tables.log.push(String(inputs.log));
      return { rowsAffected: [1] };
    }
    if (sql.startsWith("UPDATE dbo.PlayerActiveTitle SET TitleId")) {
      tables.active.set(Number(inputs.playerId), Number(inputs.titleId));
      return { rowsAffected: [1] };
    }
    if (sql.startsWith("DELETE FROM dbo.PlayerActiveTitle")) {
      tables.active.delete(Number(inputs.playerId));
      return { rowsAffected: [1] };
    }
    if (sql.startsWith("SELECT u.PlayerId, t.Code, u.SourceRef FROM dbo.PlayerTitleUnlock u")) {
      return {
        recordset: tables.unlocks.map((unlock) => ({
          PlayerId: unlock.PlayerId,
          Code: tables.titles.find((title) => title.Id === unlock.TitleId)?.Code,
          SourceRef: unlock.SourceRef,
        })),
      };
    }
    throw new Error(`Unexpected SQL: ${sql.slice(0, 80)}`);
  };
}

const codeOf = (tables: Tables, id: number | undefined): string =>
  tables.titles.find((title) => title.Id === id)?.Code ?? "";
const heldBy = (tables: Tables, playerId: number): string[] =>
  tables.unlocks
    .filter((unlock) => unlock.PlayerId === playerId)
    .map((unlock) => codeOf(tables, unlock.TitleId))
    .sort();

test("the schema step adds only what is missing and reports without --apply", async () => {
  let state: Row = { game_code: null, test_table: null };
  const statements: string[] = [];
  const database = createFakeDatabase((sql) => {
    statements.push(sql);
    if (sql === SCHEMA_STATE_QUERY) return { recordset: [state] };
    if (sql.includes("ALTER TABLE dbo.PlayerTitle ADD GameCode")) state = { game_code: 8, test_table: 77 };
    return { recordset: [] };
  });
  assert.deepEqual(await applyTitleGamesSchema(database, false), {
    applied: false,
    gameCodeColumn: "missing",
    testUnlockTable: "missing",
  });
  assert.equal(statements.length, 1, "a dry run only looks");
  assert.deepEqual(await applyTitleGamesSchema(database, true), {
    applied: true,
    gameCodeColumn: "added",
    testUnlockTable: "created",
  });
  assert.ok(statements.some((sql) => sql.includes("CREATE TABLE dbo.PlayerTitleTestUnlock")));
  assert.deepEqual(await applyTitleGamesSchema(database, true), {
    applied: false,
    gameCodeColumn: "exists",
    testUnlockTable: "exists",
  });
});

test("the data step changes exactly the rows of 2026-10-02 and keeps every unlock", async () => {
  const tables = liveTables();
  const database = createFakeDatabase(handlerFor(tables));
  const report = await applyTitleGames(database, true);
  assert.equal(report.applied, true);
  assert.deepEqual(database.transactions, ["begin", "commit"]);
  assert.deepEqual([...tables.backups], [...TITLE_GAMES_BACKUPS]);

  // 18 game variants and BURST 2026 STRIKERS TITAN of each game.
  assert.equal(report.insertedTitles.length, 21);
  for (const game of TITLE_GAMES) {
    const season = tables.titles.find((title) => title.Code === `season-titan-2-${game.suffix}`);
    assert.deepEqual(
      [season?.Name, season?.RuleKind, season?.RuleParams, season?.GameCode, season?.IsActive],
      ["BURST 2026 STRIKERS TITAN", "season-titan", '{"season_id":2}', game.code, true],
    );
  }
  const counts = { template: 0, retired: 0, fixed: 0 };
  for (const change of report.changedRows) counts[change.split(": ")[1] as keyof typeof counts] += 1;
  assert.deepEqual(counts, EXPECTED_CHANGES);
  assert.equal(tables.titles.find((title) => title.Code === "msl-2025-spring-champion")?.RuleParams, '{"names":[]}');
  assert.equal(tables.titles.find((title) => title.Code === "wfc-final-season-leader")?.RuleKind, "manual");

  // The MSL event variants come from the tournaments; every old unlock has its variant.
  assert.deepEqual(report.newVariants, [
    "msl-2022-world-champion-msc",
    "msl-2023-world-champion-msc",
    "msl-2023-summer-champion-msc",
  ]);
  assert.deepEqual(
    heldBy(tables, 9).filter((code) => code.endsWith("-msc")),
    [
      "msl-2-time-world-champion-msc",
      "msl-2022-world-champion-msc",
      "msl-2023-summer-champion-msc",
      "msl-2023-world-champion-msc",
    ],
  );
  assert.deepEqual(
    heldBy(tables, 5).filter((code) => code.endsWith("-msc")),
    ["tournament-winner-green-msc", "tournament-winner-msc"],
  );
  // Romomo-like: 4 MSBL + 1 SMS wins only add up across games, so the green title lapses.
  assert.deepEqual(
    heldBy(tables, 115).filter((code) => /-(?:msbl|msc|sms)$/.test(code)),
    ["tournament-winner-msbl", "tournament-winner-sms"],
  );
  assert.deepEqual(report.lapsed, [
    "player 115: tournament-winner-green (Tournaments:108,109,110,111,112 (5 non-MSL tournament wins))",
  ]);
  // The fixed titles go to their owners, nobody else.
  assert.deepEqual(heldBy(tables, GOLDCOBRA.player_id), [
    "wfc-200-0-season-world-record",
    "wfc-66-0-daily-world-record",
    "wfc-final-daily-leader",
  ]);
  assert.deepEqual(heldBy(tables, GIANT.player_id), ["wfc-5012-daily-points-world-record"]);
  // The old unlocks stay as history; nothing was removed.
  assert.equal(liveUnlocks(liveTitles()).length + report.granted, tables.unlocks.length);

  // Selections follow to the variant; the free one stays.
  assert.deepEqual(report.movedSelections, [
    "player 9: msl-2-time-world-champion -> msl-2-time-world-champion-msc",
    "player 115: tournament-winner-green -> tournament-winner-msbl",
  ]);
  assert.equal(codeOf(tables, tables.active.get(GOLDCOBRA.player_id)), "three-ghosts");
  assert.deepEqual(report.clearedSelections, []);
  assert.ok(
    report.openPoints.includes(
      "Title msl-2025-spring-champion: no tournament named yet, so MSL 2025 SPRING CHAMPION waits for staff.",
    ),
  );

  // Run again: nothing to change, no second backup.
  const again = createFakeDatabase(handlerFor(tables));
  const second = await applyTitleGames(again, true);
  assert.equal(second.status, "nothing to change");
  assert.ok(!again.queries.some((query) => query.sql.startsWith("SELECT * INTO")));
});

test("a dry run does all of it in the transaction and rolls it back", async () => {
  const tables = liveTables();
  const database = createFakeDatabase(handlerFor(tables));
  const report = await applyTitleGames(database, false);
  assert.equal(report.applied, false);
  assert.match(
    report.status,
    /^dry run, rolled back: inserted 21 titles, changed 34 rows, created 3 variants, granted \d+$/,
  );
  assert.deepEqual(database.transactions, ["begin", "rollback"]);
});

test("unexpected rows, an existing backup or a season that is not over change nothing", async () => {
  const drifted = liveTables();
  // Someone turned one MSL title into a template by hand: 23 instead of 24 changes.
  const event = drifted.titles.find((title) => title.Code === "msl-2023-world-champion");
  if (event) event.RuleKind = "msl-event";
  await assert.rejects(applyTitleGames(createFakeDatabase(handlerFor(drifted)), true), /Expected .* rows to change/);

  const backedUp = liveTables();
  backedUp.backups.add(TITLE_GAMES_BACKUPS[1]);
  const database = createFakeDatabase(handlerFor(backedUp));
  await assert.rejects(applyTitleGames(database, true), /exists already; nothing was saved/);
  assert.deepEqual(database.transactions, ["begin", "rollback"]);

  await assert.rejects(
    applyTitleGames(createFakeDatabase(handlerFor(liveTables(), { seasonStatus: "active" })), true),
    /Burst Season 2026 is not a completed season/,
  );
});

test("the pure parts: row changes, variants, replacements and source references", () => {
  const changes = plannedRowChanges(liveTitles().map((title): Record<string, unknown> => ({ ...title })));
  assert.equal(changes.length, 34);
  assert.deepEqual(
    changes.find((change) => change.code === "wfc-66-0-daily-world-record"),
    {
      code: "wfc-66-0-daily-world-record",
      kind: "fixed",
      ruleKind: "fixed-players",
      ruleParams: JSON.stringify({ players: [GOLDCOBRA] }),
      isActive: true,
    },
  );
  assert.deepEqual(plannedRowChanges([]), []);

  assert.deepEqual(sourceTournamentIds("Tournaments:1,8,2 (3 non-MSL tournament wins)"), [1, 8, 2]);
  assert.deepEqual(sourceTournamentIds("Tournament:211 MSL 2023 World Championship"), [211]);
  assert.deepEqual(sourceTournamentIds("PlayerStats:MSC 1v1 rank 3"), []);

  const catalog = seededCatalog();
  const title = (code: string) => {
    const found = catalog.find((entry) => entry.code === code);
    assert.ok(found, code);
    return found;
  };
  assert.deepEqual(variantBase(title("msl-2023-world-champion")), {
    base: "msl-2023-world-champion",
    wins: null,
    min: 1,
  });
  assert.deepEqual(variantBase(title("tournament-winner-green")), {
    base: "tournament-winner-green",
    wins: "side",
    min: 5,
  });
  assert.equal(variantBase(title("tournament-winner-green-msc")), null);
  assert.equal(variantBase(title("legacy-rookie")), null);

  const msc = TITLE_GAMES[1];
  const context = {
    gameOfTournament: (id: number) => (id < 200 ? (msc ?? null) : null),
    wins: (playerId: number) =>
      Array.from({ length: playerId }, (_, index) => ({
        id: index,
        name: "",
        gameType: 1,
        isComplete: true,
        winner: "",
        startDate: "",
      })),
  };
  assert.deepEqual(
    expectedVariants({ playerId: 1, sourceRef: "Tournament:150 x" }, title("msl-2023-world-champion"), context),
    ["msl-2023-world-champion-msc"],
  );
  assert.equal(
    expectedVariants({ playerId: 1, sourceRef: "Tournament:250 x" }, title("msl-2023-world-champion"), context),
    "lapsed",
  );
  assert.deepEqual(expectedVariants({ playerId: 5, sourceRef: "" }, title("tournament-winner-green"), context), [
    "tournament-winner-green-msc",
  ]);
  assert.equal(expectedVariants({ playerId: 4, sourceRef: "" }, title("tournament-winner-green"), context), "lapsed");

  const fits = replacements(title("tournament-winner-green"));
  assert.equal(fits.length, 2, "green first, then plain");
  const msbl = TITLE_GAMES[0];
  assert.ok(msbl);
  assert.equal(fits[0]?.(title("tournament-winner-green-msbl"), msbl), true);
  assert.equal(fits[0](title("tournament-winner-msbl"), msbl), false);
  assert.equal(fits[1]?.(title("tournament-winner-msbl"), msbl), true);
  assert.equal(replacements(title("tournament-winner")).length, 1);
  const [template] = replacements(title("msl-2023-world-champion"));
  assert.ok(msc);
  assert.equal(template?.({ ...title("msl-2023-world-champion"), code: "msl-2023-world-champion-msc" }, msc), true);
  assert.equal(template({ ...title("msl-2023-world-champion"), code: "msl-2024-world-champion-msc" }, msc), false);
});
