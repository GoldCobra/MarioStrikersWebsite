// SQL of the player titles: the catalog's categories and titles the database does not have yet (ops:player-titles),
// the catalog (read through a short cache), the sources the rules read, the one transaction that writes new unlocks,
// and the test unlocks (title-test-unlocks.ts). Unlocks are only ever inserted, and UQ_PlayerTitleUnlock_Player_Title
// keeps each title once per player, so a run can be repeated any number of times.

import { normalizeText } from "@ms/shared/text";
import type { Database, Queries, Row } from "../../db/database.ts";
import { sql, t, type SqlValue, type Statement } from "../../db/sql.ts";
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

/** dbo.CommandLog.Command of every applied sync run; the daily schedule reads the latest. */
export const SYNC_LOG_COMMAND = "WebsiteTitleSync";

/** The catalog changes rarely (a new title, a season title); it is read again after five minutes. */
const CATALOG_TTL_MS = 5 * 60 * 1000;

/** Grants per INSERT (4 parameters each), well below SQL Server's 2100 parameters per request. */
const GRANT_CHUNK = 200;

/** Categories or titles per INSERT of ops:player-titles (at most 11 parameters each), well below the 2100. */
const SEED_CHUNK = 100;

/** `items` in runs of at most `size`, in order. */
function chunked<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
  return chunks;
}

/** One row of a VALUES list. */
function valuesRow(values: readonly SqlValue[]): Statement {
  return sql`(${sql.list(values)})`;
}

/** Runs an INSERT that ends with SELECT @@ROWCOUNT AS inserted and returns that count. */
async function insertedRows(db: Queries, statement: Statement): Promise<number> {
  return (await db.row<{ inserted: number }>(statement))?.inserted ?? 0;
}

// ---------------------------------------------------------------------------------------------------
// The catalog's categories and titles (ops:player-titles): what the database does not have yet is added,
// nothing existing is changed.

/** Adds the categories the table does not have yet; returns how many. */
export async function insertMissingCategories(
  db: Queries,
  categories: readonly TitleCategoryDefinition[],
): Promise<number> {
  let inserted = 0;
  for (const chunk of chunked(categories, SEED_CHUNK)) {
    const rows = chunk.map((category) =>
      valuesRow([
        t.varchar(category.code, 40),
        t.nvarchar(category.name, 60),
        t.nvarchar(category.availability, 120),
        t.bit(category.isGlobal),
        t.int(category.sortOrder),
      ]),
    );
    inserted += await insertedRows(
      db,
      sql`
        INSERT INTO dbo.PlayerTitleCategory (Code, Name, Availability, IsGlobal, SortOrder)
        SELECT v.Code, v.Name, v.Availability, v.IsGlobal, v.SortOrder
        FROM (VALUES ${sql.join(rows)}) v (Code, Name, Availability, IsGlobal, SortOrder)
        WHERE NOT EXISTS (SELECT 1 FROM dbo.PlayerTitleCategory c WHERE c.Code = v.Code);
        SELECT @@ROWCOUNT AS inserted;
      `,
    );
  }
  return inserted;
}

/** Adds the titles whose code the table does not have yet; returns how many. */
export async function insertMissingTitles(db: Queries, titles: readonly TitleDefinition[]): Promise<number> {
  let inserted = 0;
  for (const chunk of chunked(titles, SEED_CHUNK)) {
    const rows = chunk.map((title) =>
      valuesRow([
        t.varchar(title.code, 64),
        t.nvarchar(title.name, 60),
        t.varchar(title.category, 40),
        t.int(title.sortOrder),
        t.varchar(title.ruleKind, 40),
        t.nvarchar(title.ruleParams ? JSON.stringify(title.ruleParams) : null, 400),
        t.varchar(title.styleKey ?? null, 20),
        t.varchar(title.exclusiveGroup ?? null, 40),
        t.int(title.exclusiveLevel ?? null),
        t.varchar(title.gameCode ?? null, 8),
        t.bit(title.isActive ?? true),
      ]),
    );
    inserted += await insertedRows(
      db,
      sql`
        INSERT INTO dbo.PlayerTitle (Code, Name, CategoryCode, SortOrder, RuleKind, RuleParams, StyleKey, ExclusiveGroup,
          ExclusiveLevel, GameCode, IsActive)
        SELECT v.Code, v.Name, v.CategoryCode, v.SortOrder, v.RuleKind, v.RuleParams, v.StyleKey, v.ExclusiveGroup,
          v.ExclusiveLevel, v.GameCode, v.IsActive
        FROM (VALUES ${sql.join(rows)}) v (Code, Name, CategoryCode, SortOrder, RuleKind, RuleParams, StyleKey,
          ExclusiveGroup, ExclusiveLevel, GameCode, IsActive)
        WHERE NOT EXISTS (SELECT 1 FROM dbo.PlayerTitle t WHERE t.Code = v.Code);
        SELECT @@ROWCOUNT AS inserted;
      `,
    );
  }
  return inserted;
}

/** Every title code the table holds (ops:player-titles checks the catalog against them). */
export async function fetchTitleCodes(db: Queries): Promise<Set<string>> {
  const rows = await db.rows<{ Code: string }>(sql`SELECT Code FROM dbo.PlayerTitle;`);
  return new Set(rows.map((row) => row.Code));
}

// ---------------------------------------------------------------------------------------------------
// Catalog

/** Every title with its category; the catalog cache, the sources and the test unlocks read it. */
const CATALOG = sql`
  SELECT t.Id, t.Code, t.Name, t.CategoryCode, t.SortOrder, t.RuleKind, t.RuleParams, t.StyleKey,
    t.ExclusiveGroup, t.ExclusiveLevel, t.GameCode, t.IsActive, c.Name AS CategoryName, c.SortOrder AS CategorySort,
    c.IsGlobal
  FROM dbo.PlayerTitle t
  INNER JOIN dbo.PlayerTitleCategory c ON c.Code = t.CategoryCode;
`;

/** A row of CATALOG: a dbo.PlayerTitle row with its category's name, order and IsGlobal. */
export interface CatalogRecord extends Row {
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
  CategoryName: string;
  CategorySort: number;
  IsGlobal: boolean;
}

const isTrue = (value: unknown): boolean => value === true || Number(value) === 1;

function toCatalogTitle(row: Row): CatalogTitle {
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

/** The catalog, read at most every five minutes; `invalidate` makes the next read fresh. */
export interface TitleCatalog {
  get(): Promise<readonly CatalogTitle[]>;
  invalidate(): void;
}

export function createTitleCatalog(db: Queries, ttlMs = CATALOG_TTL_MS): TitleCatalog {
  let cached: { readonly at: number; readonly titles: Promise<readonly CatalogTitle[]> } | null = null;
  return {
    get() {
      if (cached && Date.now() - cached.at < ttlMs) return cached.titles;
      const titles = db
        .rows<CatalogRecord>(CATALOG)
        .then((rows) => rows.map(toCatalogTitle))
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

/** A regular unlock (dbo.PlayerTitleUnlock). */
export interface UnlockRecord extends Row {
  PlayerId: number;
  TitleId: number;
}

export interface PlayerRecord extends Row {
  ID: number;
  DiscordID: string;
}

export interface TournamentRecord extends Row {
  ID: number;
  Name: string;
  GameType: number;
  IsComplete: boolean | null;
  /** Player ids, comma-separated. */
  Winner: string;
  TournamentStartDate: Date;
}

export interface SeasonRecord extends Row {
  Id: number;
  SeasonNumber: number;
  DisplayName: string;
  LifecycleStatus: string;
}

/** A player with the Strikers Titan reward level in a season, in one game (GameId: CompetitiveGame.Id). */
export interface TitanRecord extends Row {
  SeasonId: number;
  PlayerId: number;
  GameId: number;
}

/** A dbo.PlayerStats row with a legacy rank and the player's legacy matches in that game before the cutoff. */
export interface LegacyRankRecord extends Row {
  Player: number;
  GameType: number;
  Rank: number;
  Rank2v2: number;
  Singles: number;
  Teams: number;
}

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

/**
 * Every stored legacy rank with the legacy matches its player had in that game before the first competitive season
 * began (singles in dbo.Match, team matches in dbo.MultiMatch).
 */
async function readLegacyRanks(db: Queries): Promise<LegacyRankRow[]> {
  const rows = await db.rows<LegacyRankRecord>(sql`
    DECLARE @cutoff DATETIME2 = (SELECT MIN(s.StartDateUtc) FROM rocci121_toby.CompetitiveSeason s);
    WITH singles AS (
      SELECT m.Player1 AS PlayerId, m.GameType FROM dbo.Match m WHERE m.FutureMatch = 0 AND m.MatchDate < @cutoff
      UNION ALL
      SELECT m.Player2, m.GameType FROM dbo.Match m WHERE m.FutureMatch = 0 AND m.MatchDate < @cutoff
    ), singles_count AS (
      SELECT PlayerId, GameType, COUNT(*) AS Matches FROM singles GROUP BY PlayerId, GameType
    ), teams AS (
      SELECT p.PlayerId, mm.GameType FROM dbo.MultiMatch mm
      CROSS APPLY (VALUES (mm.Player1), (mm.Player2), (mm.Player3), (mm.Player4),
        (mm.Player5), (mm.Player6), (mm.Player7), (mm.Player8)) p (PlayerId)
      WHERE mm.FutureMatch = 0 AND mm.MatchDate < @cutoff AND p.PlayerId > 0
    ), teams_count AS (
      SELECT PlayerId, GameType, COUNT(*) AS Matches FROM teams GROUP BY PlayerId, GameType
    )
    SELECT ps.Player, ps.GameType, ps.Rank, ps.Rank2v2,
      ISNULL(s.Matches, 0) AS Singles, ISNULL(t.Matches, 0) AS Teams
    FROM dbo.PlayerStats ps
    LEFT JOIN singles_count s ON s.PlayerId = ps.Player AND s.GameType = ps.GameType
    LEFT JOIN teams_count t ON t.PlayerId = ps.Player AND t.GameType = ps.GameType
    WHERE ps.Rank > 0 OR ps.Rank2v2 > 0;
  `);
  return rows.flatMap(toLegacyRankRows);
}

/** Everything the rules read, in one batch; the legacy ranks only when asked for (they no longer change). */
export async function readTitleSources(db: Queries, options: { readonly legacy: boolean }): Promise<TitleSources> {
  const [catalog, unlocks, players, tournaments, seasons, titans] = (await db.sets(sql`
    ${CATALOG}
    SELECT u.PlayerId, u.TitleId FROM dbo.PlayerTitleUnlock u;
    SELECT p.ID, p.DiscordID FROM dbo.Player p;
    SELECT t.ID, t.Name, t.GameType, t.IsComplete, t.Winner, t.TournamentStartDate FROM dbo.Tournament t;
    SELECT s.Id, s.SeasonNumber, s.DisplayName, s.LifecycleStatus FROM rocci121_toby.CompetitiveSeason s;
    SELECT DISTINCT e.SeasonId, e.PlayerId, e.GameId FROM rocci121_toby.CompetitiveSeasonRewardEarned e
    WHERE e.TierOrder = ${TITAN_REWARD_TIER_ORDER};
  `)) as [CatalogRecord[], UnlockRecord[], PlayerRecord[], TournamentRecord[], SeasonRecord[], TitanRecord[]];
  return {
    catalog: catalog.map(toCatalogTitle),
    unlocks: unlocks.map((row) => ({ playerId: row.PlayerId, titleId: row.TitleId })),
    playerIds: new Set(players.map((row) => row.ID)),
    discordIds: new Map(players.map((row) => [row.ID, normalizeText(row.DiscordID)])),
    tournaments: tournaments.map(toTournament),
    seasons: seasons.map((row) => ({
      id: row.Id,
      seasonNumber: row.SeasonNumber,
      displayName: normalizeText(row.DisplayName),
      status: normalizeText(row.LifecycleStatus).toLowerCase(),
    })),
    titans: titans.map((row) => ({ seasonId: row.SeasonId, playerId: row.PlayerId, gameType: row.GameId })),
    ...(options.legacy ? { legacyRanks: await readLegacyRanks(db) } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------
// Writing

/** When the last applied sync ran (UTC), null when none ever did. */
export async function readLastSyncRun(db: Queries): Promise<Date | null> {
  const row = await db.row<{ TimeOfCommand: Date | null }>(sql`
    SELECT TOP 1 TimeOfCommand FROM dbo.CommandLog WHERE Command = ${SYNC_LOG_COMMAND} ORDER BY Id DESC;
  `);
  return row?.TimeOfCommand ?? null;
}

/** One dbo.CommandLog row: the command and its parameters as JSON, cut to the column's 4000 characters. */
export async function logCommand(
  db: Queries,
  command: string,
  parameters: Readonly<Record<string, unknown>>,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO dbo.CommandLog (Command, Parameters)
    VALUES (${command}, ${t.nvarchar(JSON.stringify(parameters).slice(0, 4000), 4000)});
  `);
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
export function writeTitleAwards(db: Database, plan: TitleAwardPlan, options: TitleWriteOptions): Promise<number> {
  return db.transaction(async (tx) => {
    for (const title of plan.newTitles) {
      const code = t.varchar(title.code, 64);
      await tx.execute(sql`
        IF NOT EXISTS (SELECT 1 FROM dbo.PlayerTitle WHERE Code = ${code})
        INSERT INTO dbo.PlayerTitle (Code, Name, CategoryCode, SortOrder, RuleKind, RuleParams, GameCode)
        VALUES (${code}, ${t.nvarchar(title.name, 60)}, ${t.varchar(title.category, 40)}, ${t.int(title.sortOrder)},
          ${t.varchar(title.ruleKind, 40)}, ${t.nvarchar(title.ruleParams, 400)}, ${t.varchar(title.gameCode, 8)});
      `);
    }
    const grantedBy = t.nvarchar(options.grantedBy, 100);
    let inserted = 0;
    for (const chunk of chunked(plan.grants, GRANT_CHUNK)) {
      const rows = chunk.map((grant) =>
        valuesRow([
          t.int(grant.playerId),
          t.varchar(grant.titleCode, 64),
          t.varchar(grant.sourceType, 20),
          t.nvarchar(grant.sourceRef, 200),
        ]),
      );
      inserted += await insertedRows(
        tx,
        sql`
          INSERT INTO dbo.PlayerTitleUnlock (PlayerId, TitleId, SourceType, SourceRef, GrantedBy)
          SELECT v.PlayerId, t.Id, v.SourceType, v.SourceRef, ${grantedBy}
          FROM (VALUES ${sql.join(rows)}) v (PlayerId, Code, SourceType, SourceRef)
          INNER JOIN dbo.PlayerTitle t ON t.Code = v.Code
          WHERE NOT EXISTS (SELECT 1 FROM dbo.PlayerTitleUnlock u WHERE u.PlayerId = v.PlayerId AND u.TitleId = t.Id);
          SELECT @@ROWCOUNT AS inserted;
        `,
      );
    }
    if (inserted !== plan.grants.length) {
      throw new Error(`Planned ${plan.grants.length} title unlocks but inserted ${inserted}; nothing was saved.`);
    }
    await logCommand(tx, SYNC_LOG_COMMAND, { granted_by: options.grantedBy, ...options.log });
    return inserted;
  });
}

// ---------------------------------------------------------------------------------------------------
// Test unlocks (title-test-unlocks.ts): dbo.PlayerTitleTestUnlock, apart from the regular unlocks so that
// removing them can never touch an earned or fixed title.

/** A title id of one player: a regular unlock, a test unlock or the selection. */
export interface TitleIdRecord extends Row {
  TitleId: number;
}

/** What a test-unlock run plans with. */
export interface TestUnlockState {
  readonly exists: boolean;
  /** The titles of the regular unlocks. */
  readonly regular: readonly number[];
  readonly tests: readonly number[];
  readonly selected: number | null;
  readonly catalog: readonly CatalogTitle[];
}

/**
 * A player's titles, read inside the run's transaction: the test unlocks and the selection stay locked until it
 * ends (UPDLOCK, HOLDLOCK), so they cannot change between this read and the run's writes.
 */
export async function readTestUnlockState(tx: Queries, playerId: number): Promise<TestUnlockState> {
  const player = t.int(playerId);
  const [players, regular, tests, selected, catalog] = (await tx.sets(sql`
    SELECT p.ID FROM dbo.Player p WHERE p.ID = ${player};
    SELECT u.TitleId FROM dbo.PlayerTitleUnlock u WHERE u.PlayerId = ${player};
    SELECT x.TitleId FROM dbo.PlayerTitleTestUnlock x WITH (UPDLOCK, HOLDLOCK) WHERE x.PlayerId = ${player};
    SELECT a.TitleId FROM dbo.PlayerActiveTitle a WITH (UPDLOCK, HOLDLOCK) WHERE a.PlayerId = ${player};
    ${CATALOG}
  `)) as [Pick<PlayerRecord, "ID">[], TitleIdRecord[], TitleIdRecord[], TitleIdRecord[], CatalogRecord[]];
  return {
    exists: players.length > 0,
    regular: regular.map((row) => row.TitleId),
    tests: tests.map((row) => row.TitleId),
    selected: selected[0]?.TitleId ?? null,
    catalog: catalog.map(toCatalogTitle),
  };
}

/** Adds one test unlock unless the player has it already; returns the rows added (0 or 1). */
export async function insertTestUnlock(
  tx: Queries,
  unlock: { readonly playerId: number; readonly titleId: number; readonly grantedBy: string; readonly note: string },
): Promise<number> {
  const player = t.int(unlock.playerId);
  const title = t.int(unlock.titleId);
  const [inserted = 0] = await tx.execute(sql`
    INSERT INTO dbo.PlayerTitleTestUnlock (PlayerId, TitleId, GrantedBy, Note)
    SELECT ${player}, ${title}, ${t.nvarchar(unlock.grantedBy, 100)}, ${t.nvarchar(unlock.note, 200)}
    WHERE NOT EXISTS (SELECT 1 FROM dbo.PlayerTitleTestUnlock x WHERE x.PlayerId = ${player} AND x.TitleId = ${title});
  `);
  return inserted;
}

/** Removes all of a player's test unlocks; returns how many. */
export async function deleteTestUnlocks(tx: Queries, playerId: number): Promise<number> {
  const [removed = 0] = await tx.execute(
    sql`DELETE FROM dbo.PlayerTitleTestUnlock WHERE PlayerId = ${t.int(playerId)};`,
  );
  return removed;
}

/**
 * Clears a player's selected title. dbo.PlayerActiveTitle's activity trigger stamps dbo.Player.Activity unless the
 * transaction pauses it (skipPlayerActivity).
 */
export async function deleteSelectedTitle(tx: Queries, playerId: number): Promise<void> {
  await tx.execute(sql`DELETE FROM dbo.PlayerActiveTitle WHERE PlayerId = ${t.int(playerId)};`);
}
