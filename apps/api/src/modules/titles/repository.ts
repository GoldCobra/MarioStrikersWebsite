// SQL of the player titles: the four tables and their seed (ops:player-titles), the catalog (read through
// a short cache), the sources the rules read, and the one transaction that writes new unlocks. Unlocks are
// only ever inserted, and UQ_PlayerTitleUnlock_Player_Title keeps each title once per player, so a run can
// be repeated any number of times.

import { normalizeText } from "@ms/shared/text";
import type { Database, Queryable } from "../../db/database.ts";
import { mssql } from "../../db/database.ts";
import { toIsoDateOnly } from "../../lib/dates.ts";
import { toPositiveIntId, toSafeCount } from "../../lib/numbers.ts";
import type { CatalogTitle } from "./availability.ts";
import type { TitleCategoryDefinition, TitleDefinition } from "./catalog.ts";
import { titleGameCode } from "./games.ts";
import {
  TITAN_REWARD_TIER_ORDER,
  type LegacyRankRow,
  type TitleAwardPlan,
  type TitleSources,
  type TournamentRow,
} from "./rules.ts";

type Row = Record<string, unknown>;

/** dbo.CommandLog.Command of every applied sync run; the daily schedule reads the latest. */
export const SYNC_LOG_COMMAND = "WebsiteTitleSync";

/** The catalog changes rarely (a new title, a season title); it is read again after five minutes. */
const CATALOG_TTL_MS = 5 * 60 * 1000;

/** Grants per INSERT, well below SQL Server's 2100 parameters per request. */
const GRANT_CHUNK = 200;

/** The game of a title (games.ts): the codes of rocci121_toby.CompetitiveGame, NULL for none. */
const GAME_CODE_COLUMN =
  "GameCode VARCHAR(8) NULL CONSTRAINT CK_PlayerTitle_GameCode CHECK (GameCode IN ('MSBL', 'MSC', 'SMS'))";

// ---------------------------------------------------------------------------------------------------
// Schema (ops:player-titles). Each table is created only when missing; nothing existing is changed.

export const SCHEMA_SQL = [
  "SET XACT_ABORT ON;",
  "IF OBJECT_ID(N'dbo.PlayerTitleCategory', N'U') IS NULL",
  "CREATE TABLE dbo.PlayerTitleCategory (",
  "  Code VARCHAR(40) NOT NULL CONSTRAINT PK_PlayerTitleCategory PRIMARY KEY,",
  "  Name NVARCHAR(60) NOT NULL,",
  "  Availability NVARCHAR(120) NOT NULL,",
  "  IsGlobal BIT NOT NULL CONSTRAINT DF_PlayerTitleCategory_IsGlobal DEFAULT (0),",
  "  SortOrder INT NOT NULL",
  ");",
  "IF OBJECT_ID(N'dbo.PlayerTitle', N'U') IS NULL",
  "CREATE TABLE dbo.PlayerTitle (",
  "  Id INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_PlayerTitle PRIMARY KEY,",
  "  Code VARCHAR(64) NOT NULL CONSTRAINT UQ_PlayerTitle_Code UNIQUE,",
  "  Name NVARCHAR(60) NOT NULL,",
  "  CategoryCode VARCHAR(40) NOT NULL CONSTRAINT FK_PlayerTitle_Category REFERENCES dbo.PlayerTitleCategory (Code),",
  "  SortOrder INT NOT NULL CONSTRAINT DF_PlayerTitle_SortOrder DEFAULT (0),",
  "  RuleKind VARCHAR(40) NOT NULL CONSTRAINT DF_PlayerTitle_RuleKind DEFAULT ('manual'),",
  "  RuleParams NVARCHAR(400) NULL,",
  "  StyleKey VARCHAR(20) NULL,",
  "  ExclusiveGroup VARCHAR(40) NULL,",
  "  ExclusiveLevel INT NULL,",
  "  IsActive BIT NOT NULL CONSTRAINT DF_PlayerTitle_IsActive DEFAULT (1),",
  "  CreatedAtUtc DATETIME2 NOT NULL CONSTRAINT DF_PlayerTitle_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),",
  `  ${GAME_CODE_COLUMN},`,
  // FULL CAPS, compared byte by byte (the database's collation ignores case), and no surrounding spaces.
  "  CONSTRAINT CK_PlayerTitle_Name CHECK (Name = UPPER(Name) COLLATE Latin1_General_100_BIN2",
  "    AND LEN(Name) > 0 AND DATALENGTH(Name) = DATALENGTH(LTRIM(RTRIM(Name)))),",
  "  CONSTRAINT CK_PlayerTitle_Code CHECK (LEN(Code) > 0",
  "    AND Code COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^a-z0-9-]%')",
  ");",
  "IF OBJECT_ID(N'dbo.PlayerTitleUnlock', N'U') IS NULL",
  "CREATE TABLE dbo.PlayerTitleUnlock (",
  "  Id INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_PlayerTitleUnlock PRIMARY KEY,",
  "  PlayerId INT NOT NULL,",
  "  TitleId INT NOT NULL CONSTRAINT FK_PlayerTitleUnlock_Title REFERENCES dbo.PlayerTitle (Id),",
  "  SourceType VARCHAR(20) NOT NULL CONSTRAINT CK_PlayerTitleUnlock_SourceType",
  "    CHECK (SourceType IN ('SEASON', 'ACCOLADE', 'TOURNAMENT', 'LEGACY_RANK', 'MANUAL')),",
  "  SourceRef NVARCHAR(200) NULL,",
  "  GrantedBy NVARCHAR(100) NOT NULL,",
  "  GrantedAtUtc DATETIME2 NOT NULL CONSTRAINT DF_PlayerTitleUnlock_GrantedAtUtc DEFAULT (SYSUTCDATETIME()),",
  "  CONSTRAINT UQ_PlayerTitleUnlock_Player_Title UNIQUE (PlayerId, TitleId)",
  ");",
  "IF OBJECT_ID(N'dbo.PlayerActiveTitle', N'U') IS NULL",
  "CREATE TABLE dbo.PlayerActiveTitle (",
  "  PlayerId INT NOT NULL CONSTRAINT PK_PlayerActiveTitle PRIMARY KEY,",
  "  TitleId INT NOT NULL CONSTRAINT FK_PlayerActiveTitle_Title REFERENCES dbo.PlayerTitle (Id),",
  "  SelectedAtUtc DATETIME2 NOT NULL CONSTRAINT DF_PlayerActiveTitle_SelectedAtUtc DEFAULT (SYSUTCDATETIME())",
  ");",
  // Temporary test unlocks (ops:title-test-unlocks), apart from the regular ones so that removing them can
  // never touch an earned or fixed title.
  "IF OBJECT_ID(N'dbo.PlayerTitleTestUnlock', N'U') IS NULL",
  "CREATE TABLE dbo.PlayerTitleTestUnlock (",
  "  Id INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_PlayerTitleTestUnlock PRIMARY KEY,",
  "  PlayerId INT NOT NULL,",
  "  TitleId INT NOT NULL CONSTRAINT FK_PlayerTitleTestUnlock_Title REFERENCES dbo.PlayerTitle (Id),",
  "  GrantedBy NVARCHAR(100) NOT NULL,",
  "  GrantedAtUtc DATETIME2 NOT NULL CONSTRAINT DF_PlayerTitleTestUnlock_GrantedAtUtc DEFAULT (SYSUTCDATETIME()),",
  "  Note NVARCHAR(200) NULL,",
  "  CONSTRAINT UQ_PlayerTitleTestUnlock_Player_Title UNIQUE (PlayerId, TitleId)",
  ");",
].join(" ");

export const TITLE_TABLES = [
  "PlayerTitleCategory",
  "PlayerTitle",
  "PlayerTitleUnlock",
  "PlayerActiveTitle",
  "PlayerTitleTestUnlock",
] as const;

/**
 * dbo.PlayerTitle.GameCode for a table created before 2026-10-02 (ops:title-games --schema, also run by
 * ops:player-titles). Only adds the column when it is missing.
 */
export const GAME_COLUMN_SQL = [
  "IF COL_LENGTH(N'dbo.PlayerTitle', N'GameCode') IS NULL",
  `ALTER TABLE dbo.PlayerTitle ADD ${GAME_CODE_COLUMN};`,
].join(" ");

export const EXISTING_TABLES_QUERY =
  "SELECT name FROM sys.tables WHERE schema_id = SCHEMA_ID(N'dbo') AND name IN (" +
  TITLE_TABLES.map((name) => `N'${name}'`).join(", ") +
  ");";

/** Inserts the categories the table does not have yet; adds its parameters to `request`. */
export function buildSeedCategoriesQuery(
  categories: readonly TitleCategoryDefinition[],
  request: mssql.Request,
): string {
  const rows = categories.map((category, index) => {
    request.input(`cCode${index}`, mssql.VarChar(40), category.code);
    request.input(`cName${index}`, mssql.NVarChar(60), category.name);
    request.input(`cAvailability${index}`, mssql.NVarChar(120), category.availability);
    request.input(`cGlobal${index}`, mssql.Bit, category.isGlobal);
    request.input(`cSort${index}`, mssql.Int, category.sortOrder);
    return `(@cCode${index}, @cName${index}, @cAvailability${index}, @cGlobal${index}, @cSort${index})`;
  });
  return [
    "INSERT INTO dbo.PlayerTitleCategory (Code, Name, Availability, IsGlobal, SortOrder)",
    "SELECT v.Code, v.Name, v.Availability, v.IsGlobal, v.SortOrder",
    `FROM (VALUES ${rows.join(", ")}) v (Code, Name, Availability, IsGlobal, SortOrder)`,
    "WHERE NOT EXISTS (SELECT 1 FROM dbo.PlayerTitleCategory c WHERE c.Code = v.Code);",
    "SELECT @@ROWCOUNT AS inserted;",
  ].join(" ");
}

/** Inserts the titles whose code the table does not have yet; adds its parameters to `request`. */
export function buildSeedTitlesQuery(titles: readonly TitleDefinition[], request: mssql.Request): string {
  const rows = titles.map((title, index) => {
    request.input(`tCode${index}`, mssql.VarChar(64), title.code);
    request.input(`tName${index}`, mssql.NVarChar(60), title.name);
    request.input(`tCategory${index}`, mssql.VarChar(40), title.category);
    request.input(`tSort${index}`, mssql.Int, title.sortOrder);
    request.input(`tKind${index}`, mssql.VarChar(40), title.ruleKind);
    request.input(`tParams${index}`, mssql.NVarChar(400), title.ruleParams ? JSON.stringify(title.ruleParams) : null);
    request.input(`tStyle${index}`, mssql.VarChar(20), title.styleKey ?? null);
    request.input(`tGroup${index}`, mssql.VarChar(40), title.exclusiveGroup ?? null);
    request.input(`tLevel${index}`, mssql.Int, title.exclusiveLevel ?? null);
    request.input(`tGame${index}`, mssql.VarChar(8), title.gameCode ?? null);
    request.input(`tActive${index}`, mssql.Bit, title.isActive ?? true);
    return `(@tCode${index}, @tName${index}, @tCategory${index}, @tSort${index}, @tKind${index}, @tParams${index}, @tStyle${index}, @tGroup${index}, @tLevel${index}, @tGame${index}, @tActive${index})`;
  });
  const columns =
    "Code, Name, CategoryCode, SortOrder, RuleKind, RuleParams, StyleKey, ExclusiveGroup, ExclusiveLevel, GameCode, IsActive";
  return [
    `INSERT INTO dbo.PlayerTitle (${columns})`,
    `SELECT ${columns
      .split(", ")
      .map((column) => `v.${column}`)
      .join(", ")}`,
    `FROM (VALUES ${rows.join(", ")}) v (${columns})`,
    "WHERE NOT EXISTS (SELECT 1 FROM dbo.PlayerTitle t WHERE t.Code = v.Code);",
    "SELECT @@ROWCOUNT AS inserted;",
  ].join(" ");
}

// ---------------------------------------------------------------------------------------------------
// Catalog

export const CATALOG_QUERY = [
  "SELECT t.Id, t.Code, t.Name, t.CategoryCode, t.SortOrder, t.RuleKind, t.RuleParams, t.StyleKey,",
  "  t.ExclusiveGroup, t.ExclusiveLevel, t.GameCode, t.IsActive, c.Name AS CategoryName, c.SortOrder AS CategorySort,",
  "  c.IsGlobal",
  "FROM dbo.PlayerTitle t",
  "INNER JOIN dbo.PlayerTitleCategory c ON c.Code = t.CategoryCode;",
].join(" ");

const isTrue = (value: unknown): boolean => value === true || Number(value) === 1;

export function toCatalogTitle(row: Row): CatalogTitle {
  return {
    id: toPositiveIntId(row.Id) ?? 0,
    code: normalizeText(row.Code),
    name: normalizeText(row.Name),
    category: normalizeText(row.CategoryCode),
    categoryName: normalizeText(row.CategoryName),
    categorySort: Number(row.CategorySort) || 0,
    isGlobal: isTrue(row.IsGlobal),
    sortOrder: Number(row.SortOrder) || 0,
    ruleKind: normalizeText(row.RuleKind),
    ruleParams: normalizeText(row.RuleParams),
    styleKey: normalizeText(row.StyleKey),
    exclusiveGroup: normalizeText(row.ExclusiveGroup),
    exclusiveLevel: Number(row.ExclusiveLevel) || 0,
    gameCode: titleGameCode(row.GameCode),
    isActive: isTrue(row.IsActive),
  };
}

function rows(set: unknown): Row[] {
  return Array.isArray(set) ? (set as Row[]) : [];
}

/** The catalog, read at most every five minutes; `invalidate` makes the next read fresh. */
export interface TitleCatalog {
  get(): Promise<readonly CatalogTitle[]>;
  invalidate(): void;
}

export function createTitleCatalog(database: Pick<Database, "withPool">, ttlMs = CATALOG_TTL_MS): TitleCatalog {
  let cached: { readonly at: number; readonly titles: Promise<readonly CatalogTitle[]> } | null = null;
  return {
    get() {
      if (cached && Date.now() - cached.at < ttlMs) return cached.titles;
      const titles = database
        .withPool(async (pool) => rows((await pool.request().query(CATALOG_QUERY)).recordset).map(toCatalogTitle))
        .catch((error: unknown) => {
          cached = null;
          throw error;
        });
      cached = { at: Date.now(), titles };
      return titles;
    },
    invalidate() {
      cached = null;
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Sources of the rules

export const TITLE_SOURCES_QUERY = [
  CATALOG_QUERY,
  "SELECT u.PlayerId, u.TitleId FROM dbo.PlayerTitleUnlock u;",
  "SELECT p.ID, p.DiscordID FROM dbo.Player p;",
  "SELECT t.ID, t.Name, t.GameType, t.IsComplete, t.Winner, t.TournamentStartDate FROM dbo.Tournament t;",
  "SELECT s.Id, s.SeasonNumber, s.DisplayName, s.LifecycleStatus FROM rocci121_toby.CompetitiveSeason s;",
  "SELECT DISTINCT e.SeasonId, e.PlayerId, e.GameId FROM rocci121_toby.CompetitiveSeasonRewardEarned e",
  `WHERE e.TierOrder = ${TITAN_REWARD_TIER_ORDER};`,
].join(" ");

// Every stored legacy rank with the legacy matches its player had in that game before the first
// competitive season began (singles in dbo.Match, team matches in dbo.MultiMatch).
export const LEGACY_RANKS_QUERY = [
  "DECLARE @cutoff DATETIME2 = (SELECT MIN(s.StartDateUtc) FROM rocci121_toby.CompetitiveSeason s);",
  "WITH singles AS (",
  "  SELECT m.Player1 AS PlayerId, m.GameType FROM dbo.Match m WHERE m.FutureMatch = 0 AND m.MatchDate < @cutoff",
  "  UNION ALL",
  "  SELECT m.Player2, m.GameType FROM dbo.Match m WHERE m.FutureMatch = 0 AND m.MatchDate < @cutoff",
  "), singles_count AS (",
  "  SELECT PlayerId, GameType, COUNT(*) AS Matches FROM singles GROUP BY PlayerId, GameType",
  "), teams AS (",
  "  SELECT p.PlayerId, mm.GameType FROM dbo.MultiMatch mm",
  "  CROSS APPLY (VALUES (mm.Player1), (mm.Player2), (mm.Player3), (mm.Player4),",
  "    (mm.Player5), (mm.Player6), (mm.Player7), (mm.Player8)) p (PlayerId)",
  "  WHERE mm.FutureMatch = 0 AND mm.MatchDate < @cutoff AND p.PlayerId > 0",
  "), teams_count AS (",
  "  SELECT PlayerId, GameType, COUNT(*) AS Matches FROM teams GROUP BY PlayerId, GameType",
  ")",
  "SELECT ps.Player, ps.GameType, ps.Rank, ps.Rank2v2,",
  "  ISNULL(s.Matches, 0) AS Singles, ISNULL(t.Matches, 0) AS Teams",
  "FROM dbo.PlayerStats ps",
  "LEFT JOIN singles_count s ON s.PlayerId = ps.Player AND s.GameType = ps.GameType",
  "LEFT JOIN teams_count t ON t.PlayerId = ps.Player AND t.GameType = ps.GameType",
  "WHERE ps.Rank > 0 OR ps.Rank2v2 > 0;",
].join(" ");

function toTournament(row: Row): TournamentRow {
  return {
    id: toPositiveIntId(row.ID) ?? 0,
    name: normalizeText(row.Name),
    gameType: Number(row.GameType) || 0,
    isComplete: isTrue(row.IsComplete),
    winner: normalizeText(row.Winner),
    startDate: toIsoDateOnly(row.TournamentStartDate),
  };
}

export function toLegacyRankRows(row: Row): LegacyRankRow[] {
  const playerId = toPositiveIntId(row.Player);
  if (!playerId) return [];
  const gameType = Number(row.GameType) || 0;
  const ranks: LegacyRankRow[] = [];
  const singles = Number(row.Rank) || 0;
  const doubles = Number(row.Rank2v2) || 0;
  if (singles > 0)
    ranks.push({ playerId, gameType, mode: "1v1", rank: singles, matchesBefore: toSafeCount(row.Singles) });
  if (doubles > 0)
    ranks.push({ playerId, gameType, mode: "2v2", rank: doubles, matchesBefore: toSafeCount(row.Teams) });
  return ranks;
}

/** Everything the rules read; the legacy ranks only when asked for (they no longer change). */
export async function readTitleSources(
  database: Pick<Database, "withPool">,
  options: { readonly legacy: boolean },
): Promise<TitleSources> {
  return database.withPool((pool) => readTitleSourcesFrom(pool, options));
}

/** readTitleSources on a pool or inside a transaction (ops:title-games reads its own changes). */
export async function readTitleSourcesFrom(
  db: Queryable,
  options: { readonly legacy: boolean },
): Promise<TitleSources> {
  const request = db.request();
  request.multiple = true;
  const sets = (await request.query(TITLE_SOURCES_QUERY)).recordsets as unknown as unknown[];
  const legacyRanks = options.legacy
    ? rows((await db.request().query(LEGACY_RANKS_QUERY)).recordset).flatMap(toLegacyRankRows)
    : undefined;
  const players = rows(sets[2]);
  return {
    catalog: rows(sets[0]).map(toCatalogTitle),
    unlocks: rows(sets[1]).map((row) => ({ playerId: Number(row.PlayerId), titleId: Number(row.TitleId) })),
    playerIds: new Set(players.map((row) => Number(row.ID))),
    discordIds: new Map(players.map((row) => [Number(row.ID), normalizeText(row.DiscordID)])),
    tournaments: rows(sets[3]).map(toTournament),
    seasons: rows(sets[4]).map((row) => ({
      id: Number(row.Id),
      seasonNumber: Number(row.SeasonNumber) || 0,
      displayName: normalizeText(row.DisplayName),
      status: normalizeText(row.LifecycleStatus).toLowerCase(),
    })),
    titans: rows(sets[5]).map((row) => ({
      seasonId: Number(row.SeasonId),
      playerId: Number(row.PlayerId),
      gameType: Number(row.GameId) || 0,
    })),
    ...(legacyRanks ? { legacyRanks } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------
// Writing

export const LAST_SYNC_QUERY =
  "SELECT TOP 1 TimeOfCommand FROM dbo.CommandLog WHERE Command = N'" + SYNC_LOG_COMMAND + "' ORDER BY Id DESC;";

/** When the last applied sync ran (UTC), null when none ever did. */
export async function readLastSyncRun(database: Pick<Database, "withPool">): Promise<Date | null> {
  const value = await database.withPool(
    async (pool) => rows((await pool.request().query(LAST_SYNC_QUERY)).recordset)[0]?.TimeOfCommand,
  );
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

/** Inserts `count` unlocks (parameters @player<n>, @code<n>, @source<n>, @ref<n>) that are still missing. */
export function buildGrantQuery(count: number): string {
  const values = Array.from(
    { length: count },
    (_, index) => `(@player${index}, @code${index}, @source${index}, @ref${index})`,
  );
  return [
    "INSERT INTO dbo.PlayerTitleUnlock (PlayerId, TitleId, SourceType, SourceRef, GrantedBy)",
    "SELECT v.PlayerId, t.Id, v.SourceType, v.SourceRef, @grantedBy",
    `FROM (VALUES ${values.join(", ")}) v (PlayerId, Code, SourceType, SourceRef)`,
    "INNER JOIN dbo.PlayerTitle t ON t.Code = v.Code",
    "WHERE NOT EXISTS (SELECT 1 FROM dbo.PlayerTitleUnlock u WHERE u.PlayerId = v.PlayerId AND u.TitleId = t.Id);",
    "SELECT @@ROWCOUNT AS inserted;",
  ].join(" ");
}

export const NEW_TITLE_QUERY = [
  "IF NOT EXISTS (SELECT 1 FROM dbo.PlayerTitle WHERE Code = @code)",
  "INSERT INTO dbo.PlayerTitle (Code, Name, CategoryCode, SortOrder, RuleKind, RuleParams, GameCode)",
  "VALUES (@code, @name, @category, @sortOrder, @ruleKind, @ruleParams, @gameCode);",
].join(" ");

const LOG_QUERY = `INSERT INTO dbo.CommandLog (Command, Parameters) VALUES (N'${SYNC_LOG_COMMAND}', @log);`;

/** Runs an INSERT that ends with SELECT @@ROWCOUNT AS inserted and returns that count. */
export async function insertedRows(request: mssql.Request, sql: string): Promise<number> {
  return toSafeCount(rows((await request.query(sql)).recordset)[0]?.inserted);
}

export interface TitleWriteOptions {
  readonly grantedBy: string;
  readonly log: Readonly<Record<string, unknown>>;
}

/**
 * One transaction: the new titles (season titles, MSL event variants), the grants, and the run in
 * dbo.CommandLog. It rolls back when fewer rows were inserted than planned (someone else wrote the same
 * unlocks meanwhile; the next run finds the rest).
 */
export async function writeTitleAwards(
  database: Pick<Database, "withTransaction">,
  plan: TitleAwardPlan,
  options: TitleWriteOptions,
): Promise<number> {
  return database.withTransaction((transaction) => writeTitleAwardsIn(transaction, plan, options));
}

/** writeTitleAwards inside a transaction the caller holds (ops:title-games). */
export async function writeTitleAwardsIn(
  transaction: Queryable,
  plan: TitleAwardPlan,
  options: TitleWriteOptions,
): Promise<number> {
  for (const title of plan.newTitles) {
    const request = transaction.request();
    request.input("code", mssql.VarChar(64), title.code);
    request.input("name", mssql.NVarChar(60), title.name);
    request.input("category", mssql.VarChar(40), title.category);
    request.input("sortOrder", mssql.Int, title.sortOrder);
    request.input("ruleKind", mssql.VarChar(40), title.ruleKind);
    request.input("ruleParams", mssql.NVarChar(400), title.ruleParams);
    request.input("gameCode", mssql.VarChar(8), title.gameCode);
    await request.query(NEW_TITLE_QUERY);
  }
  let inserted = 0;
  for (let start = 0; start < plan.grants.length; start += GRANT_CHUNK) {
    const chunk = plan.grants.slice(start, start + GRANT_CHUNK);
    const request = transaction.request();
    request.input("grantedBy", mssql.NVarChar(100), options.grantedBy);
    chunk.forEach((grant, index) => {
      request.input(`player${index}`, mssql.Int, grant.playerId);
      request.input(`code${index}`, mssql.VarChar(64), grant.titleCode);
      request.input(`source${index}`, mssql.VarChar(20), grant.sourceType);
      request.input(`ref${index}`, mssql.NVarChar(200), grant.sourceRef);
    });
    inserted += await insertedRows(request, buildGrantQuery(chunk.length));
  }
  if (inserted !== plan.grants.length) {
    throw new Error(`Planned ${plan.grants.length} title unlocks but inserted ${inserted}; nothing was saved.`);
  }
  const log = transaction.request();
  log.input(
    "log",
    mssql.NVarChar(4000),
    JSON.stringify({ granted_by: options.grantedBy, ...options.log }).slice(0, 4000),
  );
  await log.query(LOG_QUERY);
  return inserted;
}
