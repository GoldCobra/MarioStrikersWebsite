// SQL of the player list and profiles. A profile is read in one batch of nine result sets; the
// recordset order is part of the contract with mappers.ts (see PROFILE_RECORDSET).

import { mssql, type Pool } from "../../db/database.ts";

/** Result set positions of buildPlayerProfileBatchQuery(). */
export const PROFILE_RECORDSET = {
  player: 0,
  friendCodes: 1,
  summary: 2,
  competitiveRatings: 3,
  rewardLevel: 4,
  rewardProgress: 5,
  accolades: 6,
  seasonAwards: 7,
  competitiveHistory: 8,
} as const;

// A player's club: the roster entry with the best rank, then by club name.
const PLAYER_CLUB_APPLY = [
  "OUTER APPLY (",
  "  SELECT TOP 1 c.ID AS club_id, c.ClubName, c.ClanTag",
  "  FROM ClubRoster cr",
  "  INNER JOIN Club c ON c.ID = cr.Club",
  "  WHERE cr.Player = p.ID",
  "  ORDER BY ISNULL(cr.Rank, 9999), c.ClubName",
  ") club",
];

const ACTIVE_SEASON = ["WHERE season.IsActive = 1", "  AND season.LifecycleStatus = 'active'"];

export function buildPlayerProfileSummaryQuery(terminator = ""): string {
  return [
    "SELECT",
    "  p.Name,",
    "  MAX(CASE WHEN ps.GameType = 2 THEN ISNULL(CAST(ps.Wins AS NVARCHAR(5)) + '-' + CAST(ps.Losses AS NVARCHAR(5)), '0-0') END) AS SmsRecord,",
    "  MAX(CASE WHEN ps.GameType = 2 THEN CAST(ROUND(ps.RatingWHR + 1000, 0) AS INT) END) AS SmsRating,",
    "  MAX(CASE WHEN ps.GameType = 1 THEN ISNULL(CAST(ps.Wins AS NVARCHAR(5)) + '-' + CAST(ps.Losses AS NVARCHAR(5)), '0-0') END) AS MscRecord,",
    "  MAX(CASE WHEN ps.GameType = 1 THEN CAST(ROUND(ps.RatingWHR + 1000, 0) AS INT) END) AS MscRating,",
    "  MAX(CASE WHEN ps.GameType = 3 THEN ISNULL(CAST(ps.Wins AS NVARCHAR(5)) + '-' + CAST(ps.Losses AS NVARCHAR(5)), '0-0') END) AS BlRecord,",
    "  MAX(CASE WHEN ps.GameType = 3 THEN CAST(ROUND(ps.RatingWHR + 1000, 0) AS INT) END) AS BlRating,",
    "  MAX(CASE WHEN ps.GameType = 2 THEN ISNULL(CAST(ps.Wins2v2 AS NVARCHAR(5)) + '-' + CAST(ps.Losses2v2 AS NVARCHAR(5)), '0-0') END) AS SmsRecord2v2,",
    "  MAX(CASE WHEN ps.GameType = 2 THEN CAST(ROUND(ps.RatingTS + 1000, 0) AS INT) END) AS SmsRating2v2,",
    "  MAX(CASE WHEN ps.GameType = 1 THEN ISNULL(CAST(ps.Wins2v2 AS NVARCHAR(5)) + '-' + CAST(ps.Losses2v2 AS NVARCHAR(5)), '0-0') END) AS MscRecord2v2,",
    "  MAX(CASE WHEN ps.GameType = 1 THEN CAST(ROUND(ps.RatingTS + 1000, 0) AS INT) END) AS MscRating2v2,",
    "  MAX(CASE WHEN ps.GameType = 3 THEN ISNULL(CAST(ps.Wins2v2 AS NVARCHAR(5)) + '-' + CAST(ps.Losses2v2 AS NVARCHAR(5)), '0-0') END) AS BlRecord2v2,",
    "  MAX(CASE WHEN ps.GameType = 3 THEN CAST(ROUND(ps.RatingTS + 1000, 0) AS INT) END) AS BlRating2v2",
    "FROM Player p",
    "LEFT JOIN PlayerStats ps ON ps.Player = p.ID AND ps.GameType IN (1, 2, 3) AND ISNULL(p.HideStats, 0) = 0",
    "WHERE p.ID = @playerId",
    "GROUP BY p.ID, p.Name" + terminator,
  ].join(" ");
}

export function buildSeasonRewardLevelQuery(): string {
  return [
    "SELECT TOP 1",
    "  ISNULL(MAX(ISNULL(progress.HighestEarnedTierOrder, 0)), 0) AS RewardLevelOrder",
    "FROM CompetitiveSeason season",
    "LEFT JOIN CompetitiveSeasonRewardProgress progress ON progress.SeasonId = season.Id AND progress.PlayerId = @playerId",
    ...ACTIVE_SEASON,
    "GROUP BY season.Id",
    "ORDER BY season.Id DESC",
  ].join(" ");
}

// Display order for season awards on player profiles, most prestigious first.
// This order is a product decision and DELIBERATELY DIFFERS from futbot's
// SEASON_AWARD_DEFINITIONS (futbot/src/utils/competitiveSeasonAwards.js), which is
// the definition order used when awards are computed - do not "resync" the two.
// What must stay in sync is the SET of codes: an award added there needs adding here.
// Codes missing from this list sort last (then alphabetically), so a newly added
// award still shows up on profiles instead of silently vanishing.
export const SEASON_AWARD_DISPLAY_ORDER: readonly string[] = [
  "TOP_10",
  "MOST_WINS",
  "SWEEP_SPECIALIST",
  "BIGGEST_UPSET",
  "CLUTCH_PLAYER",
  "COMEBACK_KING",
  "IRON_PLAYER",
  "MOST_ACTIVE",
  "DUO_OF_THE_SEASON",
];

// Games are shown MSBL -> MSC -> SMS, which is deliberately NOT GameId order
// (1 = MSC, 2 = SMS, 3 = MSBL). Unknown ids sort last.
export const SEASON_AWARD_GAME_ORDER: readonly number[] = [3, 1, 2];

// Built from the lists above rather than hand-written, so the SQL can never drift from them.
function buildSeasonAwardOrderCase(): string {
  const whens = SEASON_AWARD_DISPLAY_ORDER.map((code, index) => `WHEN '${code}' THEN ${index}`);
  return `CASE result.AwardCode ${whens.join(" ")} ELSE ${SEASON_AWARD_DISPLAY_ORDER.length} END`;
}

function buildSeasonGameOrderCase(): string {
  const whens = SEASON_AWARD_GAME_ORDER.map((gameId, index) => `WHEN ${gameId} THEN ${index}`);
  return `CASE result.GameId ${whens.join(" ")} ELSE ${SEASON_AWARD_GAME_ORDER.length} END`;
}

export function buildSeasonAwardsQuery(): string {
  return [
    "SELECT",
    "  season.DisplayName AS SeasonName,",
    "  season.StartDateUtc AS SeasonStartDateUtc,",
    "  CASE WHEN result.GameId = 1 THEN 'MSC' WHEN result.GameId = 2 THEN 'SMS' WHEN result.GameId = 3 THEN 'MSBL' ELSE '?' END AS Game,",
    "  result.ModeCode,",
    "  result.AwardCode,",
    "  result.AwardName,",
    "  result.RankPosition,",
    "  result.MetricLabel",
    "FROM CompetitiveSeasonAwardResult result",
    "INNER JOIN CompetitiveSeasonAwardResultPlayer resultPlayer ON resultPlayer.AwardResultId = result.Id",
    "INNER JOIN CompetitiveSeason season ON season.Id = result.SeasonId",
    // 2v2 awards are withheld for now: SMS 2v2 saw a single match all of Burst, which produced
    // six awards off one game. Drop this line to bring doubles back once the mode has volume.
    "WHERE resultPlayer.PlayerId = @playerId",
    "  AND result.ModeCode = '1v1'",
    "ORDER BY season.StartDateUtc DESC, " + buildSeasonGameOrderCase() + " ASC, result.ModeCode ASC,",
    "  " + buildSeasonAwardOrderCase() + " ASC, result.AwardCode ASC, result.RankPosition ASC;",
  ].join(" ");
}

export function buildPlayerProfileBatchQuery(): string {
  return [
    "DECLARE @playerIdText NVARCHAR(20) = CONVERT(NVARCHAR(20), @playerId);",
    // 0: player
    "SELECT TOP 1",
    "  p.ID AS player_id,",
    "  p.Name AS name,",
    "  p.Country AS country,",
    "  p.IdStartGG AS id_start_gg,",
    "  p.Activity AS activity,",
    "  club.club_id AS club_id,",
    "  club.ClubName AS club_name,",
    "  club.ClanTag AS club_tag",
    "FROM Player p",
    ...PLAYER_CLUB_APPLY,
    "WHERE p.ID = @playerId;",
    // 1: friend codes
    "SELECT",
    "  fc.GameType,",
    "  fc.Region,",
    "  fc.LineSeq,",
    "  fc.Label,",
    "  fc.Code",
    "FROM FriendCodes fc",
    "WHERE fc.Player = @playerId",
    "ORDER BY",
    "  CASE WHEN fc.Region = 'SW' OR fc.GameType = 3 THEN 0 ELSE 1 END,",
    "  CASE fc.Region WHEN 'PAL' THEN 1 WHEN 'NTSC' THEN 2 WHEN 'JPN' THEN 3 WHEN 'KOR' THEN 4 ELSE 9 END,",
    "  fc.LineSeq;",
    // 2: legacy records and WHR/TST
    buildPlayerProfileSummaryQuery(";"),
    // 3: competitive ratings. Read the rating table, not the CompetitiveLeaderboard view: the view
    // drops rows without a match this season, but a rating carried into the new season still
    // belongs on the profile.
    "SELECT",
    "  rating.GameId AS GameType,",
    "  rating.ModeCode AS Mode,",
    "  rating.Elo,",
    "  rating.RankNumber,",
    "  threshold.Name AS RankName,",
    "  rating.MatchWins,",
    "  rating.MatchLosses,",
    "  rating.PlacementPlayed,",
    "  rating.PlacementComplete,",
    "  rating.MatchWins + rating.MatchLosses AS TotalMatches",
    "FROM CompetitivePlayerRating rating",
    "INNER JOIN CompetitiveSeason season ON season.Id = rating.SeasonId",
    "INNER JOIN Player player ON player.ID = rating.PlayerId",
    "LEFT JOIN CompetitiveRankThreshold threshold ON threshold.RankNumber = rating.RankNumber AND threshold.IsActive = 1",
    ...ACTIVE_SEASON,
    "  AND rating.PlayerId = @playerId",
    "  AND player.HideStats = 0",
    "ORDER BY rating.GameId ASC, rating.ModeCode ASC;",
    // 4: highest reward level this season
    buildSeasonRewardLevelQuery() + ";",
    // 5: reward progress per game and mode
    "SELECT",
    "  progress.GameId,",
    "  progress.ModeCode,",
    "  progress.HighestEarnedTier,",
    "  progress.HighestEarnedTierOrder,",
    "  progress.CurrentTargetTier,",
    "  progress.CurrentTargetTierOrder,",
    "  progress.CurrentTargetWins,",
    "  progress.RequiredWins",
    "FROM CompetitiveSeason season",
    "INNER JOIN CompetitiveSeasonRewardProgress progress ON progress.SeasonId = season.Id",
    ...ACTIVE_SEASON,
    "  AND progress.PlayerId = @playerId",
    "ORDER BY progress.GameId ASC, progress.ModeCode ASC;",
    // 6: tournament placements (Winner/RunnerUp/Bronze hold comma-separated player ids)
    "SELECT",
    "  t.Name,",
    "  placement.Place,",
    "  CASE WHEN t.GameType = 1 THEN 'MSC' WHEN t.GameType = 2 THEN 'SMS' WHEN t.GameType = 3 THEN 'MSBL' ELSE '?' END AS Game,",
    "  t.TournamentStartDate",
    "FROM Tournament t",
    "CROSS APPLY (VALUES",
    "  (CONVERT(NVARCHAR(MAX), ISNULL(t.Winner, '')), ':first_place: '),",
    "  (CONVERT(NVARCHAR(MAX), ISNULL(t.RunnerUp, '')), ':second_place: '),",
    "  (CONVERT(NVARCHAR(MAX), ISNULL(t.Bronze, '')), ':third_place: ')",
    ") placement(PlayerList, Place)",
    "WHERE (',' + REPLACE(placement.PlayerList, ' ', '') + ',') LIKE '%,' + @playerIdText + ',%'",
    "ORDER BY t.TournamentStartDate DESC, t.Name ASC;",
    // 7: season awards
    buildSeasonAwardsQuery(),
    // 8: rated matches over every season, so a card stays up for anyone who has ever played the game.
    "SELECT",
    "  rating.GameId AS GameType,",
    "  rating.ModeCode AS Mode,",
    "  SUM(rating.MatchWins + rating.MatchLosses) AS TotalMatches",
    "FROM CompetitivePlayerRating rating",
    "INNER JOIN Player player ON player.ID = rating.PlayerId",
    "WHERE rating.PlayerId = @playerId",
    "  AND player.HideStats = 0",
    "GROUP BY rating.GameId, rating.ModeCode;",
  ].join(" ");
}

export function buildPlayersListQuery(): string {
  return [
    "SELECT",
    "  p.ID AS player_id,",
    "  p.Name AS name,",
    "  p.Country AS country,",
    "  p.Activity AS activity,",
    "  club.club_id AS club_id,",
    "  club.ClubName AS club_name,",
    "  club.ClanTag AS club_tag,",
    "  CASE WHEN duplicates.normalized_name IS NULL THEN 0 ELSE 1 END AS duplicate_name",
    "FROM Player p",
    "LEFT JOIN (",
    "  SELECT LOWER(LTRIM(RTRIM(ISNULL(Name, '')))) AS normalized_name",
    "  FROM Player",
    "  WHERE LTRIM(RTRIM(ISNULL(Name, ''))) <> ''",
    "  GROUP BY LOWER(LTRIM(RTRIM(ISNULL(Name, ''))))",
    "  HAVING COUNT(*) > 1",
    ") duplicates ON duplicates.normalized_name = LOWER(LTRIM(RTRIM(ISNULL(p.Name, ''))))",
    ...PLAYER_CLUB_APPLY,
    // A player is listed once they have a start.gg id, a friend code, a rated match this season
    // or a tournament placement.
    "WHERE LTRIM(RTRIM(ISNULL(p.Name, ''))) <> ''",
    "  AND (",
    "    LTRIM(RTRIM(ISNULL(p.IdStartGG, ''))) <> ''",
    "    OR EXISTS (",
    "      SELECT 1",
    "      FROM FriendCodes fc",
    "      WHERE fc.Player = p.ID",
    "        AND LTRIM(RTRIM(ISNULL(fc.Code, ''))) <> ''",
    "    )",
    "    OR EXISTS (",
    "      SELECT 1",
    "      FROM CompetitiveLeaderboard lb",
    "      INNER JOIN CompetitiveSeason season ON season.Id = lb.SeasonId",
    "      WHERE season.IsActive = 1",
    "        AND season.LifecycleStatus = 'active'",
    "        AND lb.PlayerId = p.ID",
    "    )",
    "    OR EXISTS (",
    "      SELECT 1",
    "      FROM Tournament t",
    "      WHERE (',' + REPLACE(CONVERT(NVARCHAR(MAX), ISNULL(t.Winner, '')), ' ', '') + ',') LIKE '%,' + CONVERT(NVARCHAR(20), p.ID) + ',%'",
    "         OR (',' + REPLACE(CONVERT(NVARCHAR(MAX), ISNULL(t.RunnerUp, '')), ' ', '') + ',') LIKE '%,' + CONVERT(NVARCHAR(20), p.ID) + ',%'",
    "         OR (',' + REPLACE(CONVERT(NVARCHAR(MAX), ISNULL(t.Bronze, '')), ' ', '') + ',') LIKE '%,' + CONVERT(NVARCHAR(20), p.ID) + ',%'",
    "    )",
    "  )",
    "ORDER BY",
    "  LOWER(LTRIM(RTRIM(ISNULL(p.Name, '')))) ASC,",
    "  LTRIM(RTRIM(ISNULL(p.Name, ''))) ASC",
  ].join(" ");
}

export function buildPlayerByDiscordIdQuery(): string {
  return [
    "SELECT",
    "  p.ID AS player_id,",
    "  p.Name AS name,",
    "  p.Country AS country,",
    "  p.IdStartGG AS id_start_gg,",
    "  p.Activity AS activity,",
    "  p.DiscordID AS discord_id,",
    "  club.club_id AS club_id,",
    "  club.ClubName AS club_name,",
    "  club.ClanTag AS club_tag",
    "FROM Player p",
    ...PLAYER_CLUB_APPLY,
    "WHERE",
    "  LTRIM(RTRIM(ISNULL(p.DiscordID, ''))) = @discordId",
    "  OR LTRIM(RTRIM(ISNULL(p.DiscordID, ''))) = @discordMention",
    "  OR LTRIM(RTRIM(ISNULL(p.DiscordID, ''))) = @discordMentionBang",
    "  OR LTRIM(RTRIM(ISNULL(p.DiscordID, ''))) LIKE @discordMentionPrefix",
    "  OR LTRIM(RTRIM(ISNULL(p.DiscordID, ''))) LIKE @discordMentionBangPrefix",
    "ORDER BY p.ID ASC",
  ].join(" ");
}

type Row = Record<string, unknown>;

function recordset(result: { recordset?: unknown }): Row[] {
  return Array.isArray(result.recordset) ? (result.recordset as Row[]) : [];
}

export async function fetchPlayersList(pool: Pool): Promise<Row[]> {
  return recordset(await pool.request().query(buildPlayersListQuery()));
}

/** Players whose stored Discord id is this id or a mention of it (any legacy storage form). */
export async function fetchPlayersByDiscordId(pool: Pool, discordId: string): Promise<Row[]> {
  const request = pool.request();
  request.input("discordId", mssql.NVarChar(256), discordId);
  request.input("discordMention", mssql.NVarChar(256), `<@${discordId}>`);
  request.input("discordMentionBang", mssql.NVarChar(256), `<@!${discordId}>`);
  request.input("discordMentionPrefix", mssql.NVarChar(256), `<@${discordId}>%`);
  request.input("discordMentionBangPrefix", mssql.NVarChar(256), `<@!${discordId}>%`);
  return recordset(await request.query(buildPlayerByDiscordIdQuery()));
}

export async function fetchPlayerProfileRecordsets(
  pool: Pool,
  playerId: number,
): Promise<{ recordsets: Row[][]; dbMs: number }> {
  const request = pool.request();
  request.multiple = true;
  request.input("playerId", mssql.Int, playerId);
  const startedAt = Date.now();
  const result = await request.query(buildPlayerProfileBatchQuery());
  const recordsets = Array.isArray(result.recordsets) ? (result.recordsets as unknown as Row[][]) : [];
  return { recordsets, dbMs: Date.now() - startedAt };
}
