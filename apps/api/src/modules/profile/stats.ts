// The signed-in player's own statistics per game, for MY PROFILE only (GET /api/profile/me/stats; owner,
// 2026-10-03). One batch reads everything for one player (stats-repository.ts); buildProfileStats turns its
// result sets into the fields of the three games (no database code here, so the fixtures use it too). Every value comes from data the site already keeps, all of it 1v1 (the ranked
// ladder, WHR and the match records are 1v1); a value that is missing or cannot be shown reliably is null
// (the page shows "-"), a real zero stays zero. Nothing played is such a zero: every rated match of the active
// season has its rating row and every 1v1 match its PlayerStats row (checked on the live data, 2026-10-03),
// so without the row the season W-L and the totals are 0-0 - in every game alike, whether or not some other
// record created an empty row there. Rank, ELO and WHR only exist once played and stay "-" until then.
//
//   season rank, ELO, W-L  CompetitivePlayerRating of the active season (IsActive and LifecycleStatus
//                          'active', like the public rating cards), rank names from CompetitiveRankThreshold
//   highest season rank    the highest RankNumber ever recorded in any season: the rating rows (rank and
//                          peak), every rated match (CompetitiveRatingChange.RankAfter) and the season
//                          snapshots (peak and final) - PeakRankNumber alone missed ranks after a rollover
//   current WHR            1000 + PlayerStats.RatingWHR, as everywhere, once the game has WHR history
//   highest WHR            1000 + the highest dbo.WhrRatingHistory value (the history is recalculated as a
//                          whole by futbot, so this is its current best day, not a frozen record)
//   total W-L, matches, %  PlayerStats.MatchWins / MatchLosses: the match records the bots keep, legacy
//                          reports and the competitive mirrors in one count (CompetitiveWhrSync); draws do
//                          not count, so matches = W + L and the win % is W / (W + L)
//   highest legacy rank    the stored legacy rank (PlayerStats.Rank / Rank2v2) as the legacy rank titles count
//                          it (titles/rules.ts countedLegacyTier: backed by enough legacy matches before the
//                          competitive start); the stored rank is the last one, earlier peaks were not kept

import { normalizeText } from "@ms/shared/text";
import { toSafeCount } from "../../lib/numbers.ts";
import { TITLE_GAMES, type TitleGameCode } from "../titles/games.ts";
import { countedLegacyTier, legacyTierName } from "../titles/legacy.ts";

type Row = Record<string, unknown>;

/** One game's fields, in the order MY PROFILE shows them; null = not available ("-"). */
export interface GameStats {
  readonly game: TitleGameCode;
  readonly seasonRank: string | null;
  readonly seasonElo: number | null;
  readonly seasonWins: number | null;
  readonly seasonLosses: number | null;
  readonly highestSeasonRank: string | null;
  readonly currentWhr: number | null;
  readonly highestWhr: number | null;
  readonly totalWins: number | null;
  readonly totalLosses: number | null;
  readonly totalMatches: number | null;
  /** W / (W + L) × 100, rounded to two decimals; null without matches. */
  readonly totalWinPercent: number | null;
  readonly highestLegacyRank: string | null;
}

export interface ProfileStats {
  /** The active season's name ("Dusk Season 2026"); "" between seasons. */
  readonly season: string;
  /** MSBL, MSC, SMS - always all three. */
  readonly games: readonly GameStats[];
}

/** Result set positions of buildProfileStatsQuery() (stats-repository.ts). */
export const PROFILE_STATS_SETS = {
  season: 0,
  seasonRatings: 1,
  highestRanks: 2,
  playerStats: 3,
  whrHistory: 4,
  legacyRanks: 5,
} as const;

function set(recordsets: unknown, index: number): Row[] {
  const value = Array.isArray(recordsets) ? (recordsets as unknown[])[index] : undefined;
  return Array.isArray(value) ? (value as Row[]) : [];
}

/** A number from the database, or null for NULL and anything else that is no finite number. */
function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function byGame(rows: readonly Row[], column: string): Map<number, Row> {
  return new Map(rows.map((row) => [Number(row[column]), row]));
}

/** W / (W + L) × 100 with two decimals; null when no match counts. */
export function winPercent(wins: number, losses: number): number | null {
  const matches = wins + losses;
  return matches > 0 ? Math.round((wins / matches) * 10000) / 100 : null;
}

export function buildProfileStats(recordsets: unknown): ProfileStats {
  const season = set(recordsets, PROFILE_STATS_SETS.season)[0];
  const ratings = byGame(set(recordsets, PROFILE_STATS_SETS.seasonRatings), "GameId");
  const highest = byGame(set(recordsets, PROFILE_STATS_SETS.highestRanks), "GameId");
  const stats = byGame(set(recordsets, PROFILE_STATS_SETS.playerStats), "GameType");
  const whr = byGame(set(recordsets, PROFILE_STATS_SETS.whrHistory), "GameType");
  const legacy = new Map<number, number>();
  for (const row of set(recordsets, PROFILE_STATS_SETS.legacyRanks)) {
    const gameType = Number(row.GameType);
    const tier = Math.max(
      countedLegacyTier({ mode: "1v1", rank: Number(row.Rank) || 0, matchesBefore: toSafeCount(row.Singles) }),
      countedLegacyTier({ mode: "2v2", rank: Number(row.Rank2v2) || 0, matchesBefore: toSafeCount(row.Teams) }),
    );
    if (tier > (legacy.get(gameType) ?? 0)) legacy.set(gameType, tier);
  }

  const games = TITLE_GAMES.map((game): GameStats => {
    const rating = season ? ratings.get(game.gameType) : undefined;
    const elo = numberOrNull(rating?.Elo);
    // Without a row nothing was played (see the top); a row with an unreadable count stays unknown.
    const seasonWins = season ? (rating ? numberOrNull(rating.MatchWins) : 0) : null;
    const seasonLosses = season ? (rating ? numberOrNull(rating.MatchLosses) : 0) : null;
    const best = highest.get(game.gameType);
    const record = stats.get(game.gameType);
    const totalWins = record ? numberOrNull(record.MatchWins) : 0;
    const totalLosses = record ? numberOrNull(record.MatchLosses) : 0;
    const hasTotals = totalWins !== null && totalLosses !== null;
    const history = whr.get(game.gameType);
    const hasWhr = toSafeCount(history?.Days) > 0;
    const currentWhr = hasWhr ? numberOrNull(record?.Whr) : null;
    const maxWhr = hasWhr ? numberOrNull(history?.MaxWhr) : null;
    const legacyTier = legacy.get(game.gameType) ?? 0;
    return {
      game: game.code,
      seasonRank: rating ? normalizeText(rating.RankName) || null : null,
      seasonElo: elo === null ? null : Math.round(elo),
      seasonWins: seasonWins !== null && seasonLosses !== null ? seasonWins : null,
      seasonLosses: seasonWins !== null && seasonLosses !== null ? seasonLosses : null,
      highestSeasonRank: best ? normalizeText(best.RankName) || null : null,
      currentWhr,
      highestWhr: maxWhr === null ? null : Math.max(maxWhr, currentWhr ?? maxWhr),
      totalWins: hasTotals ? totalWins : null,
      totalLosses: hasTotals ? totalLosses : null,
      totalMatches: hasTotals ? totalWins + totalLosses : null,
      totalWinPercent: hasTotals ? winPercent(totalWins, totalLosses) : null,
      highestLegacyRank: legacyTier ? legacyTierName(legacyTier) || null : null,
    };
  });
  return { season: season ? normalizeText(season.DisplayName) : "", games };
}

/** GET /api/profile/me/stats in the API's snake_case. */
export function toProfileStatsResponse(stats: ProfileStats): Record<string, unknown> {
  return {
    season: stats.season,
    games: stats.games.map((game) => ({
      game: game.game,
      season_rank: game.seasonRank,
      season_elo: game.seasonElo,
      season_wins: game.seasonWins,
      season_losses: game.seasonLosses,
      highest_season_rank: game.highestSeasonRank,
      current_whr: game.currentWhr,
      highest_whr: game.highestWhr,
      total_wins: game.totalWins,
      total_losses: game.totalLosses,
      total_matches: game.totalMatches,
      total_win_percent: game.totalWinPercent,
      highest_legacy_rank: game.highestLegacyRank,
    })),
  };
}
