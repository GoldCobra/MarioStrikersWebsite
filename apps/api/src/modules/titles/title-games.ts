// The per-game titles of 2026-10-02 in the database (npm run ops:title-games, docs/adr/0009):
//
//   --schema           adds dbo.PlayerTitle.GameCode and dbo.PlayerTitleTestUnlock where missing, nothing else;
//                      the running API ignores both, so this goes first, before the release that reads them
//   (no flag)          dry run of the data step: all of it in one transaction, reported, then rolled back
//   --apply            the data step, committed
//
// The data step, in one transaction:
//   1. copies the three tables it changes to dbo.*_Backup_20261002b (refuses when a copy exists)
//   2. adds the catalog's missing titles (the 18 game variants of N-TIME WORLD CHAMPION and TOURNAMENT
//      WINNER) and BURST 2026 STRIKERS TITAN for each game (owner: for the test unlocks; nobody earned it)
//   3. changes exactly 34 existing rows to catalog.ts: 24 MSL event titles become templates (msl-event),
//      the 6 titles without a game are retired, 4 WFC titles become fixed-players
//   4. awards what the rules give now, the legacy ranks included; this creates the MSL event variants
//   5. moves a selected title that is now a template or retired to the player's variant (the game with the
//      most counted wins, then the site's game order), or clears it when the player has none
//   6. checks that every unlock of a template or retired title has its variant, except wins that only add
//      up across games (owner, 2026-10-02: they no longer count), and that no selected title is invalid
// Any other count or a failed check rolls everything back. Once done, a run finds nothing to change.

import { toText } from "@ms/shared/text";
import type { Database, Queryable } from "../../db/database.ts";
import { mssql } from "../../db/database.ts";
import { availableTitles, isTemplateTitle, selectedTitle, type CatalogTitle } from "./availability.ts";
import { TEMPLATE_RULE_KIND, TITLE_CATALOG, TITLE_CATEGORY, type TitleDefinition } from "./catalog.ts";
import { TITLE_GAMES, gameByCode, gameByType, gameRank, type TitleGame } from "./games.ts";
import {
  GAME_COLUMN_SQL,
  SCHEMA_SQL,
  buildSeedTitlesQuery,
  insertedRows,
  readTitleSourcesFrom,
  writeTitleAwardsIn,
} from "./repository.ts";
import { countedWins, planTitleAwards, seasonTitanTitleName, type TitleSources, type TournamentRow } from "./rules.ts";

type Row = Record<string, unknown>;

export const TITLE_GAMES_BACKUPS = [
  "dbo.PlayerTitle_Backup_20261002b",
  "dbo.PlayerTitleUnlock_Backup_20261002b",
  "dbo.PlayerActiveTitle_Backup_20261002b",
] as const;
const BACKED_UP = ["dbo.PlayerTitle", "dbo.PlayerTitleUnlock", "dbo.PlayerActiveTitle"] as const;

/** The rows of 2026-10-02 this step changes: MSL templates, retired titles, fixed WFC titles. */
export const EXPECTED_CHANGES = { template: 24, retired: 6, fixed: 4 } as const;
/** The completed season whose STRIKERS TITAN titles the owner wanted for the test unlocks. */
export const TEST_SEASON_NAME = "Burst Season 2026";
const GRANTED_BY = "ops:title-games";

// ---------------------------------------------------------------------------------------------------
// --schema

export interface TitleGamesSchemaReport {
  readonly applied: boolean;
  readonly gameCodeColumn: "exists" | "added" | "missing";
  readonly testUnlockTable: "exists" | "created" | "missing";
}

export const SCHEMA_STATE_QUERY =
  "SELECT COL_LENGTH(N'dbo.PlayerTitle', N'GameCode') AS game_code, OBJECT_ID(N'dbo.PlayerTitleTestUnlock', N'U') AS test_table;";

const present = (value: unknown): boolean => value !== null && value !== undefined;

export async function applyTitleGamesSchema(
  database: Pick<Database, "withTransaction">,
  apply: boolean,
): Promise<TitleGamesSchemaReport> {
  return database.withTransaction(async (transaction) => {
    const before = ((await transaction.request().query(SCHEMA_STATE_QUERY)).recordset as Row[])[0] ?? {};
    const hasColumn = present(before.game_code);
    const hasTable = present(before.test_table);
    if (!apply || (hasColumn && hasTable)) {
      return {
        applied: false,
        gameCodeColumn: hasColumn ? "exists" : "missing",
        testUnlockTable: hasTable ? "exists" : "missing",
      };
    }
    await transaction.request().query(SCHEMA_SQL);
    await transaction.request().query(GAME_COLUMN_SQL);
    const after = ((await transaction.request().query(SCHEMA_STATE_QUERY)).recordset as Row[])[0] ?? {};
    if (!present(after.game_code) || !present(after.test_table)) {
      throw new Error("GameCode or PlayerTitleTestUnlock still missing after the change; rolled back.");
    }
    return {
      applied: true,
      gameCodeColumn: hasColumn ? "exists" : "added",
      testUnlockTable: hasTable ? "exists" : "created",
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// Data step: what changes

export interface RowChange {
  readonly code: string;
  readonly kind: keyof typeof EXPECTED_CHANGES;
  readonly ruleKind: string;
  readonly ruleParams: string | null;
  readonly isActive: boolean;
}

const jsonParams = (value: Readonly<Record<string, unknown>> | undefined): string | null =>
  value ? JSON.stringify(value) : null;

/** The stored rows whose RuleKind, RuleParams or IsActive differ from catalog.ts, by kind of change. */
export function plannedRowChanges(stored: readonly Row[]): RowChange[] {
  const byCode = new Map(stored.map((row) => [String(row.Code), row]));
  const changes: RowChange[] = [];
  for (const title of TITLE_CATALOG) {
    const row = byCode.get(title.code);
    if (!row) continue;
    const want = {
      ruleKind: title.ruleKind,
      ruleParams: jsonParams(title.ruleParams),
      isActive: title.isActive ?? true,
    };
    const have = {
      ruleKind: toText(row.RuleKind),
      ruleParams: row.RuleParams === null || row.RuleParams === undefined ? null : toText(row.RuleParams),
      isActive: row.IsActive === true || Number(row.IsActive) === 1,
    };
    if (have.ruleKind === want.ruleKind && have.ruleParams === want.ruleParams && have.isActive === want.isActive) {
      continue;
    }
    const kind =
      title.ruleKind === TEMPLATE_RULE_KIND ? "template" : title.ruleKind === "fixed-players" ? "fixed" : "retired";
    if (kind === "retired" && want.isActive) {
      throw new Error(
        `Title ${title.code} differs from catalog.ts in a way this step does not change; nothing was saved.`,
      );
    }
    changes.push({ code: title.code, kind, ...want });
  }
  return changes;
}

/** The base whose game variants replace a template or a retired title without a game; null for others. */
export function variantBase(
  title: Pick<CatalogTitle, "code" | "ruleKind" | "ruleParams" | "isActive" | "gameCode">,
): { readonly base: string; readonly wins: "championships" | "side" | null; readonly min: number } | null {
  if (isTemplateTitle(title)) return { base: title.code, wins: null, min: 1 };
  if (title.isActive || title.gameCode) return null;
  const wins =
    title.ruleKind === "world-championship-count"
      ? "championships"
      : title.ruleKind === "side-tournament-count"
        ? "side"
        : null;
  if (!wins) return null;
  let min: number;
  try {
    min = Number((JSON.parse(title.ruleParams || "{}") as { min?: unknown }).min) || 0;
  } catch {
    min = 0;
  }
  return min > 0 ? { base: title.code, wins, min } : null;
}

export const variantCode = (base: string, game: TitleGame): string => `${base}-${game.suffix}`;

/** The tournament ids of an unlock's SourceRef ("Tournament:211 …", "Tournaments:1,8,2 (…)"). */
export function sourceTournamentIds(sourceRef: string): number[] {
  const match = /^Tournaments?:([\d,]+)/.exec(sourceRef);
  return match?.[1]
    ? match[1]
        .split(",")
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0)
    : [];
}

export interface CoverageContext {
  /** The game of a tournament id. */
  readonly gameOfTournament: (id: number) => TitleGame | null;
  /** A player's counted wins (rules.ts countedWins). */
  readonly wins: (playerId: number, kind: "championships" | "side") => readonly TournamentRow[];
}

/**
 * The variants an unlock of a template or retired title needs now: the event's game for a template, every
 * game with enough wins for a count title; "lapsed" when the wins reach `min` only across games.
 */
export function expectedVariants(
  unlock: { readonly playerId: number; readonly sourceRef: string },
  title: Pick<CatalogTitle, "code" | "ruleKind" | "ruleParams" | "isActive" | "gameCode">,
  context: CoverageContext,
): string[] | "lapsed" {
  const variant = variantBase(title);
  if (!variant) return [];
  if (!variant.wins) {
    const games = [...new Set(sourceTournamentIds(unlock.sourceRef).map(context.gameOfTournament))];
    const [game] = games;
    return games.length === 1 && game ? [variantCode(variant.base, game)] : "lapsed";
  }
  const won = context.wins(unlock.playerId, variant.wins);
  const games = TITLE_GAMES.filter((game) => won.filter((t) => t.gameType === game.gameType).length >= variant.min);
  return games.length ? games.map((game) => variantCode(variant.base, game)) : "lapsed";
}

// ---------------------------------------------------------------------------------------------------
// Data step: running it

export interface TitleGamesReport {
  readonly applied: boolean;
  readonly status: string;
  readonly insertedTitles: readonly string[];
  readonly changedRows: readonly string[];
  readonly newVariants: readonly string[];
  readonly granted: number;
  readonly grantsByTitle: Readonly<Record<string, number>>;
  readonly movedSelections: readonly string[];
  readonly clearedSelections: readonly string[];
  /** Unlocks of retired titles whose wins only add up across games: they lapse (owner, 2026-10-02). */
  readonly lapsed: readonly string[];
  /** Selections that were already invalid before (they show nothing); left as they are. */
  readonly invalidBefore: readonly string[];
  readonly openPoints: readonly string[];
}

class DryRun extends Error {
  readonly report: TitleGamesReport;
  constructor(report: TitleGamesReport) {
    super("dry run");
    this.report = report;
  }
}

export async function applyTitleGames(
  database: Pick<Database, "withTransaction">,
  apply: boolean,
): Promise<TitleGamesReport> {
  try {
    return await database.withTransaction(async (transaction) => {
      const report = await migrate(transaction);
      if (!report.applied && report.status === "nothing to change") return report;
      if (!apply) throw new DryRun({ ...report, applied: false, status: `dry run, rolled back: ${report.status}` });
      return report;
    });
  } catch (error) {
    if (error instanceof DryRun) return error.report;
    throw error;
  }
}

async function tableExists(db: Queryable, name: string): Promise<boolean> {
  const request = db.request();
  request.input("name", mssql.NVarChar(128), name);
  const rows = (await request.query("SELECT OBJECT_ID(@name, N'U') AS id;")).recordset as Row[];
  return present(rows[0]?.id);
}

/** The STRIKERS TITAN titles of the owner's test season, one per game. */
async function testSeasonTitles(db: Queryable): Promise<TitleDefinition[]> {
  const request = db.request();
  request.input("name", mssql.NVarChar(100), TEST_SEASON_NAME);
  const [season] = (
    await request.query(
      "SELECT s.Id, s.SeasonNumber, s.DisplayName, s.LifecycleStatus FROM rocci121_toby.CompetitiveSeason s WHERE s.DisplayName = @name;",
    )
  ).recordset as Row[];
  if (!season || String(season.LifecycleStatus).toLowerCase() !== "completed") {
    throw new Error(`${TEST_SEASON_NAME} is not a completed season; nothing was saved.`);
  }
  const seasonId = Number(season.Id);
  return TITLE_GAMES.map((game) => ({
    code: `season-titan-${String(seasonId)}-${game.suffix}`,
    name: seasonTitanTitleName(String(season.DisplayName)),
    category: TITLE_CATEGORY.season,
    sortOrder: Number(season.SeasonNumber) || 0,
    ruleKind: "season-titan",
    ruleParams: { season_id: seasonId },
    gameCode: game.code,
  }));
}

interface Selection {
  readonly playerId: number;
  readonly titleId: number;
}

async function readSelections(db: Queryable): Promise<Selection[]> {
  return ((await db.request().query("SELECT PlayerId, TitleId FROM dbo.PlayerActiveTitle;")).recordset as Row[]).map(
    (row) => ({ playerId: Number(row.PlayerId), titleId: Number(row.TitleId) }),
  );
}

async function readTestUnlocks(db: Queryable): Promise<Map<number, number[]>> {
  const rows = (await db.request().query("SELECT PlayerId, TitleId FROM dbo.PlayerTitleTestUnlock;"))
    .recordset as Row[];
  return groupByPlayer(rows.map((row) => ({ playerId: Number(row.PlayerId), titleId: Number(row.TitleId) })));
}

function groupByPlayer(
  rows: readonly { readonly playerId: number; readonly titleId: number }[],
): Map<number, number[]> {
  const byPlayer = new Map<number, number[]>();
  for (const row of rows) byPlayer.set(row.playerId, [...(byPlayer.get(row.playerId) ?? []), row.titleId]);
  return byPlayer;
}

async function migrate(transaction: Queryable): Promise<TitleGamesReport> {
  const stored = (
    await transaction.request().query("SELECT Id, Code, RuleKind, RuleParams, IsActive, GameCode FROM dbo.PlayerTitle;")
  ).recordset as Row[];
  const storedCodes = new Set(stored.map((row) => String(row.Code)));
  const toInsert = [...TITLE_CATALOG, ...(await testSeasonTitles(transaction))].filter(
    (title) => !storedCodes.has(title.code),
  );
  const changes = plannedRowChanges(stored);
  const storedById = new Map(
    stored.map((row) => [
      Number(row.Id),
      {
        code: String(row.Code),
        ruleKind: toText(row.RuleKind),
        ruleParams: toText(row.RuleParams),
        isActive: row.IsActive === true || Number(row.IsActive) === 1,
        gameCode: gameByCode(row.GameCode)?.code ?? "",
      } as const,
    ]),
  );
  const pendingMoves = (await readSelections(transaction)).filter((selection) => {
    const title = storedById.get(selection.titleId);
    return title ? variantBase(title) !== null : false;
  });
  if (!toInsert.length && !changes.length && !pendingMoves.length) return emptyReport("nothing to change");
  const before = await readTitleSourcesFrom(transaction, { legacy: false });
  const invalidBefore = await invalidSelections(transaction, before, await readTestUnlocks(transaction));

  const counts = { template: 0, retired: 0, fixed: 0 };
  for (const change of changes) counts[change.kind] += 1;
  if (changes.length && JSON.stringify(counts) !== JSON.stringify(EXPECTED_CHANGES)) {
    throw new Error(
      `Expected ${JSON.stringify(EXPECTED_CHANGES)} rows to change, found ${JSON.stringify(counts)}; nothing was saved.`,
    );
  }

  // 1. backups
  for (const backup of TITLE_GAMES_BACKUPS) {
    if (await tableExists(transaction, backup)) throw new Error(`${backup} exists already; nothing was saved.`);
  }
  for (const [index, table] of BACKED_UP.entries()) {
    await transaction.request().query(`SELECT * INTO ${TITLE_GAMES_BACKUPS[index]} FROM ${table};`);
  }

  // 2. new titles
  if (toInsert.length) {
    const request = transaction.request();
    const inserted = await insertedRows(request, buildSeedTitlesQuery(toInsert, request));
    if (inserted !== toInsert.length) {
      throw new Error(`Planned ${toInsert.length} new titles but inserted ${inserted}; nothing was saved.`);
    }
  }

  // 3. changed rows
  for (const change of changes) {
    const request = transaction.request();
    request.input("code", mssql.VarChar(64), change.code);
    request.input("ruleKind", mssql.VarChar(40), change.ruleKind);
    request.input("ruleParams", mssql.NVarChar(400), change.ruleParams);
    request.input("isActive", mssql.Bit, change.isActive);
    const result = await request.query(
      "UPDATE dbo.PlayerTitle SET RuleKind = @ruleKind, RuleParams = @ruleParams, IsActive = @isActive WHERE Code = @code;",
    );
    if ((result.rowsAffected[0] ?? 0) !== 1)
      throw new Error(`Title ${change.code} was not changed; nothing was saved.`);
  }

  // 4. awards (creates the MSL event variants)
  const plan = planTitleAwards(await readTitleSourcesFrom(transaction, { legacy: true }));
  const grantsByTitle: Record<string, number> = {};
  for (const grant of plan.grants) grantsByTitle[grant.titleCode] = (grantsByTitle[grant.titleCode] ?? 0) + 1;
  const granted =
    plan.grants.length || plan.newTitles.length
      ? await writeTitleAwardsIn(transaction, plan, {
          grantedBy: GRANTED_BY,
          log: { granted: plan.grants.length, titles: grantsByTitle, new_titles: plan.newTitles.map((t) => t.code) },
        })
      : 0;

  // 5. selections, 6. checks (a selection the player could not select before stays as it was: it shows nothing)
  const sources = await readTitleSourcesFrom(transaction, { legacy: false });
  const tests = await readTestUnlocks(transaction);
  const { moved, cleared } = await moveSelections(transaction, sources, tests);
  const lapsed = await checkCoverage(transaction, sources);
  const invalid = (await invalidSelections(transaction, sources, tests)).filter(
    (entry) => !invalidBefore.includes(entry),
  );
  if (invalid.length) throw new Error(`Selected titles invalid now: ${invalid.join("; ")}; nothing was saved.`);

  return {
    applied: true,
    status: `inserted ${toInsert.length} titles, changed ${changes.length} rows, created ${plan.newTitles.length} variants, granted ${granted}`,
    insertedTitles: toInsert.map((title) => title.code),
    changedRows: changes.map((change) => `${change.code}: ${change.kind}`),
    newVariants: plan.newTitles.map((title) => title.code),
    granted,
    grantsByTitle,
    movedSelections: moved,
    clearedSelections: cleared,
    lapsed,
    invalidBefore,
    openPoints: plan.openPoints,
  };
}

function emptyReport(status: string): TitleGamesReport {
  return {
    applied: false,
    status,
    insertedTitles: [],
    changedRows: [],
    newVariants: [],
    granted: 0,
    grantsByTitle: {},
    movedSelections: [],
    clearedSelections: [],
    lapsed: [],
    invalidBefore: [],
    openPoints: [],
  };
}

function winsOf(sources: TitleSources): CoverageContext["wins"] {
  const wins = countedWins(sources);
  return (playerId, kind) => wins[kind].get(playerId) ?? [];
}

type Fits = (candidate: CatalogTitle, game: TitleGame) => boolean;

/**
 * Which offered titles can replace a selected template or retired title, best first: the event's variant;
 * the N-TIME level a game offers (its group shows only the highest); the green TOURNAMENT WINNER of a game,
 * else the plain one; the plain one for the plain one.
 */
export function replacements(title: Pick<CatalogTitle, "code" | "ruleKind" | "styleKey" | "category">): Fits[] {
  if (title.ruleKind === TEMPLATE_RULE_KIND)
    return [(candidate, game) => candidate.code === variantCode(title.code, game)];
  const sameKind: Fits = (candidate) => candidate.ruleKind === title.ruleKind && candidate.category === title.category;
  if (title.ruleKind === "side-tournament-count") {
    const green: Fits = (candidate, game) => sameKind(candidate, game) && candidate.styleKey === "green";
    const plain: Fits = (candidate, game) => sameKind(candidate, game) && candidate.styleKey !== "green";
    return title.styleKey === "green" ? [green, plain] : [plain];
  }
  return [sameKind];
}

async function moveSelections(
  db: Queryable,
  sources: TitleSources,
  tests: ReadonlyMap<number, number[]>,
): Promise<{ moved: string[]; cleared: string[] }> {
  const moved: string[] = [];
  const cleared: string[] = [];
  const unlocked = groupByPlayer(sources.unlocks);
  const byId = new Map(sources.catalog.map((title) => [title.id, title]));
  const wins = winsOf(sources);
  for (const selection of await readSelections(db)) {
    const title = byId.get(selection.titleId);
    const variant = title ? variantBase(title) : null;
    if (!title || !variant) continue;
    const offered = availableTitles(sources.catalog, unlocked.get(selection.playerId) ?? [], {
      playerId: selection.playerId,
      testUnlockedIds: tests.get(selection.playerId) ?? [],
    });
    const winsIn = (game: TitleGame): number =>
      variant.wins ? wins(selection.playerId, variant.wins).filter((t) => t.gameType === game.gameType).length : 0;
    let target: CatalogTitle | null = null;
    for (const fits of replacements(title)) {
      const candidates = offered.flatMap((candidate) => {
        const game = gameByCode(candidate.gameCode);
        return game && fits(candidate, game) ? [{ candidate, game }] : [];
      });
      candidates.sort((a, b) => winsIn(b.game) - winsIn(a.game) || gameRank(a.game.code) - gameRank(b.game.code));
      target = candidates[0]?.candidate ?? null;
      if (target) break;
    }
    const request = db.request();
    request.input("playerId", mssql.Int, selection.playerId);
    if (target) {
      request.input("titleId", mssql.Int, target.id);
      await request.query("UPDATE dbo.PlayerActiveTitle SET TitleId = @titleId WHERE PlayerId = @playerId;");
      moved.push(`player ${selection.playerId}: ${title.code} -> ${target.code}`);
    } else {
      await request.query("DELETE FROM dbo.PlayerActiveTitle WHERE PlayerId = @playerId;");
      cleared.push(`player ${selection.playerId}: ${title.code}`);
    }
  }
  return { moved, cleared };
}

/** Every unlock of a template or retired title has its variants; returns the lapsed ones. */
async function checkCoverage(db: Queryable, sources: TitleSources): Promise<string[]> {
  const rows = (
    await db
      .request()
      .query(
        "SELECT u.PlayerId, t.Code, u.SourceRef FROM dbo.PlayerTitleUnlock u INNER JOIN dbo.PlayerTitle t ON t.Id = u.TitleId;",
      )
  ).recordset as Row[];
  const byCode = new Map(sources.catalog.map((title) => [title.code, title]));
  const held = new Set(rows.map((row) => `${Number(row.PlayerId)}|${String(row.Code)}`));
  const gameById = new Map(sources.tournaments.map((tournament) => [tournament.id, gameByType(tournament.gameType)]));
  const context: CoverageContext = { gameOfTournament: (id) => gameById.get(id) ?? null, wins: winsOf(sources) };
  const lapsed: string[] = [];
  const missing: string[] = [];
  for (const row of rows) {
    const title = byCode.get(String(row.Code));
    if (!title || !variantBase(title)) continue;
    const unlock = { playerId: Number(row.PlayerId), sourceRef: toText(row.SourceRef) };
    const expected = expectedVariants(unlock, title, context);
    const label = `player ${unlock.playerId}: ${title.code} (${unlock.sourceRef})`;
    if (expected === "lapsed") lapsed.push(label);
    else for (const code of expected) if (!held.has(`${unlock.playerId}|${code}`)) missing.push(`${label} -> ${code}`);
  }
  if (missing.length) throw new Error(`Unlocks without their game variant: ${missing.join("; ")}; nothing was saved.`);
  return lapsed;
}

/** Selections the player can no longer select ("player 5: tournament-winner"). */
async function invalidSelections(
  db: Queryable,
  sources: TitleSources,
  tests: ReadonlyMap<number, number[]>,
): Promise<string[]> {
  const unlocked = groupByPlayer(sources.unlocks);
  const codeById = new Map(sources.catalog.map((title) => [title.id, title.code]));
  return (await readSelections(db))
    .filter(
      (selection) =>
        !selectedTitle(sources.catalog, unlocked.get(selection.playerId) ?? [], selection.titleId, {
          playerId: selection.playerId,
          testUnlockedIds: tests.get(selection.playerId) ?? [],
        }),
    )
    .map((selection) => `player ${selection.playerId}: ${codeById.get(selection.titleId) ?? selection.titleId}`);
}
