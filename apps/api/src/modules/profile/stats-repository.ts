// SQL of MY PROFILE's statistics (stats.ts says what each value is and where it comes from): one batch of
// result sets for one player, the player taken from the signed session's Discord account.

import { mssql, type Database, type Pool } from "../../db/database.ts";
import { findLinkedPlayerId } from "../players/service.ts";
import { buildProfileStats, type ProfileStats } from "./stats.ts";

const ACTIVE_SEASON = "s.IsActive = 1 AND s.LifecycleStatus = 'active'";
const RANK_NAME =
  "LEFT JOIN rocci121_toby.CompetitiveRankThreshold t ON t.RankNumber = x.RankNumber AND t.IsActive = 1";

/** The result sets of PROFILE_STATS_SETS, in that order. */
export function buildProfileStatsQuery(): string {
  return [
    "DECLARE @cutoff DATETIME2 = (SELECT MIN(c.StartDateUtc) FROM rocci121_toby.CompetitiveSeason c);",
    // 0: the active season
    `SELECT TOP 1 s.Id, s.DisplayName FROM rocci121_toby.CompetitiveSeason s WHERE ${ACTIVE_SEASON} ORDER BY s.Id DESC;`,
    // 1: the player's 1v1 ratings in it
    "SELECT x.GameId, x.Elo, x.RankNumber, x.MatchWins, x.MatchLosses, t.Name AS RankName",
    "FROM rocci121_toby.CompetitivePlayerRating x",
    "INNER JOIN rocci121_toby.CompetitiveSeason s ON s.Id = x.SeasonId",
    RANK_NAME,
    `WHERE x.PlayerId = @playerId AND x.ModeCode = '1v1' AND ${ACTIVE_SEASON};`,
    // 2: the highest rank ever recorded per game
    "SELECT x.GameId, x.RankNumber, t.Name AS RankName FROM (",
    "  SELECT h.GameId, MAX(h.RankNumber) AS RankNumber FROM (",
    "    SELECT r.GameId, r.RankNumber FROM rocci121_toby.CompetitivePlayerRating r WHERE r.PlayerId = @playerId AND r.ModeCode = '1v1'",
    "    UNION ALL SELECT r.GameId, r.PeakRankNumber FROM rocci121_toby.CompetitivePlayerRating r WHERE r.PlayerId = @playerId AND r.ModeCode = '1v1'",
    "    UNION ALL SELECT c.GameId, c.RankAfter FROM rocci121_toby.CompetitiveRatingChange c WHERE c.PlayerId = @playerId AND c.ModeCode = '1v1'",
    "    UNION ALL SELECT n.GameId, n.PeakRankNumber FROM rocci121_toby.CompetitiveSeasonSnapshot n WHERE n.PlayerId = @playerId AND n.ModeCode = '1v1'",
    "    UNION ALL SELECT n.GameId, n.FinalRankNumber FROM rocci121_toby.CompetitiveSeasonSnapshot n WHERE n.PlayerId = @playerId AND n.ModeCode = '1v1'",
    "  ) h WHERE h.RankNumber IS NOT NULL GROUP BY h.GameId",
    ") x",
    `${RANK_NAME};`,
    // 3: WHR and the match records
    "SELECT ps.GameType, CAST(ROUND(ps.RatingWHR + 1000, 0) AS INT) AS Whr, ps.MatchWins, ps.MatchLosses",
    "FROM dbo.PlayerStats ps WHERE ps.Player = @playerId AND ps.GameType IN (1, 2, 3);",
    // 4: the WHR history
    "SELECT h.GameType, CAST(ROUND(MAX(h.RatingWHR) + 1000, 0) AS INT) AS MaxWhr, COUNT(*) AS Days",
    "FROM dbo.WhrRatingHistory h WHERE h.Player = @playerId GROUP BY h.GameType;",
    // 5: the stored legacy ranks with the legacy matches before the competitive start (titles/repository.ts
    // LEGACY_RANKS_QUERY, for one player)
    "SELECT ps.GameType, ps.Rank, ps.Rank2v2,",
    "  (SELECT COUNT(*) FROM dbo.Match m WHERE m.FutureMatch = 0 AND m.MatchDate < @cutoff",
    "    AND m.GameType = ps.GameType AND m.Player1 = @playerId)",
    "  + (SELECT COUNT(*) FROM dbo.Match m WHERE m.FutureMatch = 0 AND m.MatchDate < @cutoff",
    "    AND m.GameType = ps.GameType AND m.Player2 = @playerId) AS Singles,",
    "  (SELECT COUNT(*) FROM dbo.MultiMatch mm",
    "    CROSS APPLY (VALUES (mm.Player1), (mm.Player2), (mm.Player3), (mm.Player4),",
    "      (mm.Player5), (mm.Player6), (mm.Player7), (mm.Player8)) p (PlayerId)",
    "    WHERE mm.FutureMatch = 0 AND mm.MatchDate < @cutoff AND mm.GameType = ps.GameType",
    "      AND p.PlayerId = @playerId) AS Teams",
    "FROM dbo.PlayerStats ps WHERE ps.Player = @playerId AND ps.GameType IN (1, 2, 3)",
    "  AND (ps.Rank > 0 OR ps.Rank2v2 > 0);",
  ].join(" ");
}

export async function fetchProfileStatsRecordsets(pool: Pool, playerId: number): Promise<unknown> {
  const request = pool.request();
  request.multiple = true;
  request.input("playerId", mssql.Int, playerId);
  return (await request.query(buildProfileStatsQuery())).recordsets;
}

/**
 * The statistics of the player linked to this Discord account (from the signed session, never from the
 * request); null when none is linked. One batch, read fresh on every call like the rest of /api/profile/me.
 */
export async function getProfileStatsByDiscordId(
  database: Pick<Database, "withPool">,
  discordId: string,
): Promise<ProfileStats | null> {
  const playerId = await findLinkedPlayerId(database, discordId);
  if (playerId === null) return null;
  return buildProfileStats(await database.withPool((pool) => fetchProfileStatsRecordsets(pool, playerId)));
}
