// SQL of the leaderboards: the active season's ELO ladders from the CompetitiveLeaderboard view, and the all-time
// WHR ladder from dbo.PlayerStats (RatingWHR, which futbot recalculates), keyed by player id.

import type { Queries } from "../../db/database.ts";
import { sql, t } from "../../db/sql.ts";

/** A row of the active season's ladder, as the view has it. */
export interface CompetitiveLeaderboardRecord {
  player_id: number;
  discord_user_id: string;
  display_name: string;
  total_matches: number;
  total_wins: number;
  total_losses: number;
  rating: number;
  rank_number: number;
  competitive_rank: string | null;
  updated_at: Date;
}

/** A player of the WHR ladder with the shown rating and the legacy record. */
export interface WhrLeaderboardRecord {
  player_id: number;
  discord_user_id: string;
  display_name: string;
  rating: number;
  total_wins: number;
  total_losses: number;
  total_draws: number;
}

export function fetchCompetitiveLeaderboard(
  db: Queries,
  gameType: number,
  mode: string,
  limit: number,
  offset: number,
): Promise<CompetitiveLeaderboardRecord[]> {
  // The mode stays VARCHAR like the view's Mode column, so the column is compared as it is.
  return db.rows<CompetitiveLeaderboardRecord>(sql`
    SELECT lb.PlayerId AS player_id, lb.DiscordId AS discord_user_id,
      lb.PlayerName AS display_name, lb.TotalMatches AS total_matches, lb.MatchWins AS total_wins,
      lb.MatchLosses AS total_losses, lb.Elo AS rating, lb.RankNumber AS rank_number,
      lb.RankName AS competitive_rank, lb.UpdatedAtUtc AS updated_at
    FROM rocci121_toby.CompetitiveLeaderboard lb
    INNER JOIN rocci121_toby.CompetitiveSeason season ON season.Id = lb.SeasonId
    WHERE season.IsActive = 1
      AND season.LifecycleStatus = 'active'
      AND lb.GameType = ${gameType}
      AND lb.Mode = ${t.varchar(mode, 10)}
      AND ISNULL(lb.RankNumber, 0) > 0
    ORDER BY lb.Position ASC, lb.Elo DESC, lb.PlayerName ASC
    OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY;
  `);
}

/**
 * Every player of a game's WHR ladder, unordered. Who is listed follows the Discord bot's rating list: active, at
 * least 10 counted matches, and a match of the game (since `playedWithin` when given). The rating is shown as
 * 1000 + RatingWHR, rounded.
 */
export function fetchWhrLeaderboard(
  db: Queries,
  gameType: number,
  playedWithin: Date | null,
): Promise<WhrLeaderboardRecord[]> {
  const since = playedWithin ? sql`AND m.MatchDate >= ${t.dateTime2(playedWithin, 0)}` : sql``;
  return db.rows<WhrLeaderboardRecord>(sql`
    SELECT p.ID AS player_id, p.DiscordID AS discord_user_id, p.Name AS display_name,
      CAST(ROUND(ps.RatingWHR, 0, 0) AS INT) + 1000 AS rating,
      ps.Wins AS total_wins, ps.Losses AS total_losses, ps.MatchDraws AS total_draws
    FROM dbo.PlayerStats ps
    INNER JOIN dbo.Player p ON p.ID = ps.Player
    WHERE ps.GameType = ${gameType}
      AND ps.IsActive = 1
      AND ps.MatchWins + ps.MatchLosses >= 10
      AND EXISTS (
        SELECT 1
        FROM dbo.Match m
        WHERE m.GameType = ps.GameType
          AND (m.Player1 = p.ID OR m.Player2 = p.ID)
          ${since}
      );
  `);
}
