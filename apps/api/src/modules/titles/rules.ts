// Which titles the data awards: pure rules over a snapshot of the sources (repository.ts reads it). A
// title's RuleKind and its JSON RuleParams (dbo.PlayerTitle) choose its rule:
//
//   everyone                  Free Titles: nothing to award, the category is global
//   manual                    staff only
//   season-titan              {"season_id": n}: Strikers Titan reward level 5/5 in that season (any game and
//                             mode; the rank alone is not enough), awarded once the season is completed. A
//                             season that ends with a Titan gets its title "<SEASON> <YEAR> STRIKERS TITAN"
//                             created here.
//   tournament-name           {"names": [...]}: winners of the completed tournaments with exactly these names
//   world-championship-count  {"min": n}: at least n won MSL World Championships
//   side-tournament-count     {"min": n}: at least n clear wins of completed non-MSL tournaments
//   legacy-rank               {"tier": 1-5}: the highest legacy rank held when the competitive ranks began
//
// Unclear data awards nothing and becomes an open point instead: team and doubles wins, side brackets, a
// winner that is no player, a legacy rank that rests on matches played after the competitive start.

import { normalizeText, toText } from "@ms/shared/text";
import { formatSeasonAwardSeasonName } from "../players/mappers.ts";
import { titleText, type CatalogTitle } from "./availability.ts";
import { TITLE_CATEGORY } from "./catalog.ts";

/** CompetitiveSeasonRewardEarned.TierOrder of Strikers Titan (packages/shared/src/ranks.ts). */
export const TITAN_REWARD_TIER_ORDER = 7;

/** Every MSL event, also the side events with MSL in their name; none counts as a tournament win. */
const MSL = /\bMSL\b/i;

/** An MSL World Championship, by the exact form of its name ("MSL 2023 World Championship"). */
export const WORLD_CHAMPIONSHIP = /^MSL (?:Season \d+|\d{4}) World Championship$/i;
const WORLD_CHAMPIONSHIP_LIKE = /^MSL\b.*\bWorld Championship\b/i;

/** Side brackets and divisions: their wins are not counted for tournament titles until staff decide. */
export const SIDE_BRACKET = /\b(?:consolation|bracket|division|amateur|rookie)\b|kritter memorial/i;

const GAME_NAMES: Readonly<Record<number, string>> = { 1: "MSC", 2: "SMS", 3: "MSBL" };
const LEGACY_RANK_NAMES = ["", "Rookie", "Professional", "Superstar", "Legend", "Megastriker"];

/** Legacy matches a rank needed before it showed (dbo.tr_UpdateRank): 10 in 1v1, 4 in 2v2. */
const LEGACY_MIN_MATCHES = { "1v1": 10, "2v2": 4 } as const;

export interface TournamentRow {
  readonly id: number;
  readonly name: string;
  readonly gameType: number;
  readonly isComplete: boolean;
  /** dbo.Tournament.Winner: player ids, comma-separated. */
  readonly winner: string;
  /** ISO date; "" when unknown. */
  readonly startDate: string;
}

export interface SeasonRow {
  readonly id: number;
  readonly seasonNumber: number;
  readonly displayName: string;
  /** CompetitiveSeason.LifecycleStatus: "completed" once the season has ended. */
  readonly status: string;
}

/** A player who earned the Strikers Titan reward level in a season. */
export interface TitanRow {
  readonly seasonId: number;
  readonly playerId: number;
}

/** A stored legacy rank (PlayerStats.Rank or Rank2v2) and the legacy matches before the competitive start. */
export interface LegacyRankRow {
  readonly playerId: number;
  readonly gameType: number;
  readonly mode: "1v1" | "2v2";
  readonly rank: number;
  readonly matchesBefore: number;
}

export interface UnlockRow {
  readonly playerId: number;
  readonly titleId: number;
}

export interface TitleSources {
  readonly catalog: readonly CatalogTitle[];
  readonly unlocks: readonly UnlockRow[];
  readonly playerIds: ReadonlySet<number>;
  readonly tournaments: readonly TournamentRow[];
  readonly seasons: readonly SeasonRow[];
  readonly titans: readonly TitanRow[];
  /** Read by the full run only (ops:title-sync): legacy ranks no longer change. */
  readonly legacyRanks?: readonly LegacyRankRow[];
}

export type TitleSourceType = "SEASON" | "ACCOLADE" | "TOURNAMENT" | "LEGACY_RANK" | "MANUAL";

export interface TitleGrant {
  readonly playerId: number;
  readonly titleCode: string;
  readonly sourceType: TitleSourceType;
  /** Where it comes from, e.g. "Tournament:211 MSL 2023 World Championship" (at most 200 characters). */
  readonly sourceRef: string;
}

/** A season title to create before its grants. */
export interface NewTitle {
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly sortOrder: number;
  readonly ruleKind: "season-titan";
  readonly ruleParams: string;
}

export interface TitleAwardPlan {
  readonly newTitles: readonly NewTitle[];
  /** Only unlocks the players do not have yet. */
  readonly grants: readonly TitleGrant[];
  readonly openPoints: readonly string[];
}

/** The player ids of a Winner column; [] when it names nobody, null when it holds anything else ("-1"). */
export function parseWinners(value: unknown): number[] | null {
  const ids = toText(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number);
  return ids.every((id) => Number.isInteger(id) && id > 0) ? [...new Set(ids)] : null;
}

/** The legacy rank tier of a PlayerStats rank: 1-3 Rookie, 4-6 Professional … 13 Megastriker; 0 for none. */
export function legacyTier(rank: number): number {
  return Number.isInteger(rank) && rank >= 1 && rank <= 13 ? Math.floor((rank - 1) / 3) + 1 : 0;
}

/** "Dusk Season 2026" → "DUSK 2026 STRIKERS TITAN". */
export function seasonTitanTitleName(displayName: string): string {
  return `${titleText(formatSeasonAwardSeasonName(displayName))} STRIKERS TITAN`;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

interface Tournament extends TournamentRow {
  readonly winners: number[] | null;
}

export function planTitleAwards(sources: TitleSources): TitleAwardPlan {
  const grants: TitleGrant[] = [];
  const newTitles: NewTitle[] = [];
  const openPoints: string[] = [];
  const noted = new Set<string>();
  const note = (text: string): void => {
    if (noted.has(text)) return;
    noted.add(text);
    openPoints.push(text);
  };

  const codeById = new Map(sources.catalog.map((title) => [title.id, title.code]));
  const held = new Set(sources.unlocks.map((unlock) => `${unlock.playerId}|${codeById.get(unlock.titleId) ?? ""}`));
  const grant = (playerId: number, titleCode: string, sourceType: TitleSourceType, sourceRef: string): void => {
    const key = `${playerId}|${titleCode}`;
    if (held.has(key)) return;
    held.add(key);
    grants.push({ playerId, titleCode, sourceType, sourceRef: sourceRef.slice(0, 200) });
  };

  const tournaments: Tournament[] = sources.tournaments
    .map((row) => ({ ...row, name: normalizeText(row.name), winners: parseWinners(row.winner) }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id - b.id);
  const label = (tournament: Tournament): string =>
    `Tournament ${tournament.id} "${tournament.name}" (${GAME_NAMES[tournament.gameType] ?? `game ${tournament.gameType}`})`;

  /** The winners of a completed tournament who are players; null when it records none. */
  function recordedWinners(tournament: Tournament): number[] | null {
    if (!tournament.winners?.length) return null;
    const players = tournament.winners.filter((id) => {
      if (sources.playerIds.has(id)) return true;
      note(`${label(tournament)}: winner ${id} is no player, so it awards nothing to them.`);
      return false;
    });
    return players.length ? players : null;
  }

  let worldChampionships: Map<number, Tournament[]> | null = null;
  function championshipWins(): Map<number, Tournament[]> {
    if (worldChampionships) return worldChampionships;
    worldChampionships = new Map();
    for (const tournament of tournaments) {
      if (!WORLD_CHAMPIONSHIP.test(tournament.name)) {
        if (WORLD_CHAMPIONSHIP_LIKE.test(tournament.name)) {
          note(`${label(tournament)}: named like a World Championship but not counted as one.`);
        }
        continue;
      }
      if (!tournament.isComplete) continue;
      for (const playerId of recordedWinners(tournament) ?? []) {
        worldChampionships.set(playerId, [...(worldChampionships.get(playerId) ?? []), tournament]);
      }
    }
    return worldChampionships;
  }

  let sideWins: Map<number, Tournament[]> | null = null;
  function tournamentWins(): Map<number, Tournament[]> {
    if (sideWins) return sideWins;
    sideWins = new Map();
    for (const tournament of tournaments) {
      if (MSL.test(tournament.name) || !tournament.isComplete) continue;
      const winners = recordedWinners(tournament);
      if (!winners) continue;
      const unclear =
        winners.length > 1
          ? "a team or doubles win"
          : SIDE_BRACKET.test(tournament.name)
            ? "a side bracket or division"
            : GAME_NAMES[tournament.gameType]
              ? ""
              : "not one game";
      if (unclear) {
        note(`${label(tournament)}: ${unclear}, not counted for TOURNAMENT WINNER until staff decide.`);
        continue;
      }
      const [playerId] = winners as [number];
      sideWins.set(playerId, [...(sideWins.get(playerId) ?? []), tournament]);
    }
    return sideWins;
  }

  let legacy: Map<number, { tier: number; row: LegacyRankRow }> | null = null;
  function bestLegacyRanks(rows: readonly LegacyRankRow[]): Map<number, { tier: number; row: LegacyRankRow }> {
    if (legacy) return legacy;
    legacy = new Map();
    const unclear: LegacyRankRow[] = [];
    for (const row of rows) {
      const tier = legacyTier(row.rank);
      if (!tier || !sources.playerIds.has(row.playerId)) continue;
      if (row.matchesBefore < LEGACY_MIN_MATCHES[row.mode]) {
        unclear.push(row);
        continue;
      }
      const best = legacy.get(row.playerId);
      if (!best || tier > best.tier || (tier === best.tier && row.rank > best.row.rank)) {
        legacy.set(row.playerId, { tier, row });
      }
    }
    for (const row of unclear) {
      const tier = legacyTier(row.rank);
      if (tier <= (legacy.get(row.playerId)?.tier ?? 0)) continue;
      note(
        `Player ${row.playerId}: legacy ${LEGACY_RANK_NAMES[tier] ?? ""} (${GAME_NAMES[row.gameType] ?? row.gameType} ${row.mode}) ` +
          `rests on ${row.matchesBefore} matches before the competitive start (${LEGACY_MIN_MATCHES[row.mode]} needed), not counted.`,
      );
    }
    return legacy;
  }

  for (const title of sources.catalog) {
    if (!title.isActive) continue;
    let params: Record<string, unknown> = {};
    if (title.ruleParams) {
      try {
        const parsed: unknown = JSON.parse(title.ruleParams);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("no object");
        params = parsed as Record<string, unknown>;
      } catch {
        note(`Title ${title.code}: RuleParams is no JSON object, so it awards nothing.`);
        continue;
      }
    }
    const name = titleText(title.name);
    switch (title.ruleKind) {
      case "everyone":
      case "manual":
      case "season-titan":
        break;
      case "tournament-name": {
        const names = Array.isArray(params.names)
          ? new Set((params.names as unknown[]).map((entry) => normalizeText(entry).toLowerCase()).filter(Boolean))
          : null;
        if (!names) {
          note(`Title ${title.code}: RuleParams need "names".`);
          break;
        }
        for (const tournament of tournaments) {
          if (!names.has(tournament.name.toLowerCase())) continue;
          const winners = tournament.isComplete ? recordedWinners(tournament) : null;
          if (!winners) {
            const reason = tournament.isComplete ? "no winner recorded" : "not completed";
            note(`${label(tournament)}: ${reason}, so it awards ${name} to nobody.`);
            continue;
          }
          for (const playerId of winners)
            grant(playerId, title.code, "ACCOLADE", `Tournament:${tournament.id} ${tournament.name}`);
        }
        break;
      }
      case "world-championship-count":
      case "side-tournament-count": {
        const min = positiveInt(params.min);
        if (!min) {
          note(`Title ${title.code}: RuleParams need "min".`);
          break;
        }
        const championships = title.ruleKind === "world-championship-count";
        const wins = championships ? championshipWins() : tournamentWins();
        const what = championships ? "MSL World Championship" : "non-MSL tournament win";
        for (const [playerId, won] of [...wins].sort((a, b) => a[0] - b[0])) {
          if (won.length < min) continue;
          // The tournaments that made the count reach `min`.
          const ids = won.slice(0, min).map((tournament) => tournament.id);
          const source = `Tournaments:${ids.join(",")} (${min} ${what}${min === 1 ? "" : "s"})`;
          grant(playerId, title.code, championships ? "ACCOLADE" : "TOURNAMENT", source);
        }
        break;
      }
      case "legacy-rank": {
        if (!sources.legacyRanks) break;
        const tier = positiveInt(params.tier);
        if (!tier) {
          note(`Title ${title.code}: RuleParams need "tier".`);
          break;
        }
        for (const [playerId, best] of [...bestLegacyRanks(sources.legacyRanks)].sort((a, b) => a[0] - b[0])) {
          if (best.tier !== tier) continue;
          const { gameType, mode, rank } = best.row;
          grant(
            playerId,
            title.code,
            "LEGACY_RANK",
            `PlayerStats:${GAME_NAMES[gameType] ?? gameType} ${mode} rank ${rank}`,
          );
        }
        break;
      }
      default:
        note(`Title ${title.code}: unknown rule kind "${title.ruleKind}", so it awards nothing.`);
    }
  }

  // Season titles: one per season that ended with at least one Strikers Titan.
  const seasonTitles = new Map<number, CatalogTitle>();
  for (const title of sources.catalog) {
    if (title.ruleKind !== "season-titan") continue;
    try {
      const seasonId = positiveInt((JSON.parse(title.ruleParams || "{}") as Record<string, unknown>).season_id);
      if (seasonId) seasonTitles.set(seasonId, title);
      else note(`Title ${title.code}: RuleParams need "season_id".`);
    } catch {
      note(`Title ${title.code}: RuleParams is no JSON object, so it awards nothing.`);
    }
  }
  const completed = new Map(sources.seasons.filter((season) => season.status === "completed").map((s) => [s.id, s]));
  const titans = new Map<number, number[]>();
  for (const row of sources.titans) {
    if (!completed.has(row.seasonId)) continue;
    titans.set(row.seasonId, [...new Set([...(titans.get(row.seasonId) ?? []), row.playerId])]);
  }
  for (const [seasonId, players] of [...titans].sort((a, b) => a[0] - b[0])) {
    const season = completed.get(seasonId);
    if (!season) continue;
    const existing = seasonTitles.get(seasonId);
    if (existing && !existing.isActive) continue;
    let code = existing?.code;
    if (!code) {
      code = `season-titan-${seasonId}`;
      newTitles.push({
        code,
        name: seasonTitanTitleName(season.displayName),
        category: TITLE_CATEGORY.season,
        sortOrder: season.seasonNumber,
        ruleKind: "season-titan",
        ruleParams: JSON.stringify({ season_id: seasonId }),
      });
    }
    for (const playerId of players.sort((a, b) => a - b)) {
      if (!sources.playerIds.has(playerId)) {
        note(`Season ${seasonId}: Strikers Titan ${playerId} is no player.`);
        continue;
      }
      grant(playerId, code, "SEASON", `CompetitiveSeason:${seasonId} ${season.displayName}`);
    }
  }

  return { newTitles, grants, openPoints };
}
