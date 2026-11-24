// SQL of the player list and profiles. A profile is read in one batch of twelve result sets; their order is the
// contract with mappers.ts (PROFILE_RECORDSET). The competitive tables live in the rocci121_toby schema (futbot's),
// players, clubs, friend codes, tournaments and titles in dbo.

import type { Queries, Row } from "../../db/database.ts";
import { sql, t, type Statement } from "../../db/sql.ts";

/** Result set positions of the profile batch (fetchPlayerProfileRecordsets). */
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
  selectedTitle: 9,
  unlockedTitles: 10,
  testUnlockedTitles: 11,
} as const;

/** A profile as the player list reads it; the name comes from the server's member list (server-names.ts). */
export interface ListProfileRecord extends Row {
  player_id: number;
  discord_id: string;
  country: string | null;
  activity: Date | null;
}

interface ClubTagRecord extends Row {
  tag: string;
}

/** A player whose stored Discord id names the account in one of its legacy forms. */
export interface DiscordPlayerRecord extends Row {
  player_id: number;
  name: string;
  country: string | null;
  id_start_gg: string | null;
  activity: Date | null;
  discord_id: string;
  club_id: number | null;
  club_name: string | null;
  club_tag: string | null;
}

// A player's club: the roster entry with the best rank, then by club name.
const PLAYER_CLUB_APPLY = sql`
  OUTER APPLY (
    SELECT TOP 1 c.ID AS club_id, c.ClubName, c.ClanTag
    FROM dbo.ClubRoster cr
    INNER JOIN dbo.Club c ON c.ID = cr.Club
    WHERE cr.Player = p.ID
    ORDER BY ISNULL(cr.Rank, 9999), c.ClubName
  ) club`;

const ACTIVE_SEASON = sql`season.IsActive = 1 AND season.LifecycleStatus = 'active'`;

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
function buildSeasonAwardOrderCase(): Statement {
  const whens = SEASON_AWARD_DISPLAY_ORDER.map((code, index) => `WHEN '${code}' THEN ${index}`);
  return sql.raw(`CASE result.AwardCode ${whens.join(" ")} ELSE ${SEASON_AWARD_DISPLAY_ORDER.length} END`);
}

function buildSeasonGameOrderCase(): Statement {
  const whens = SEASON_AWARD_GAME_ORDER.map((gameId, index) => `WHEN ${gameId} THEN ${index}`);
  return sql.raw(`CASE result.GameId ${whens.join(" ")} ELSE ${SEASON_AWARD_GAME_ORDER.length} END`);
}

// The parts of the profile batch, in PROFILE_RECORDSET order; each reads the batch's @playerId.

// 0: the player and their club.
const PROFILE_PLAYER = sql`
  SELECT TOP 1 p.ID AS player_id, p.Name AS name, p.Country AS country, p.IdStartGG AS id_start_gg,
    p.Activity AS activity, club.club_id AS club_id, club.ClubName AS club_name, club.ClanTag AS club_tag
  FROM dbo.Player p
  ${PLAYER_CLUB_APPLY}
  WHERE p.ID = @playerId;
`;

// 1: friend codes.
const PROFILE_FRIEND_CODES = sql`
  SELECT fc.GameType, fc.Region, fc.LineSeq, fc.Label, fc.Code
  FROM dbo.FriendCodes fc
  WHERE fc.Player = @playerId
  ORDER BY CASE WHEN fc.Region = 'SW' OR fc.GameType = 3 THEN 0 ELSE 1 END,
    CASE fc.Region WHEN 'PAL' THEN 1 WHEN 'NTSC' THEN 2 WHEN 'JPN' THEN 3 WHEN 'KOR' THEN 4 ELSE 9 END,
    fc.LineSeq;
`;

// 2: legacy records and WHR/TST per game; none while the player hides their stats.
const PROFILE_SUMMARY = sql`
  SELECT p.Name,
    MAX(CASE WHEN ps.GameType = 2 THEN ISNULL(CAST(ps.Wins AS NVARCHAR(5)) + '-' + CAST(ps.Losses AS NVARCHAR(5)), '0-0') END) AS SmsRecord,
    MAX(CASE WHEN ps.GameType = 2 THEN CAST(ROUND(ps.RatingWHR + 1000, 0) AS INT) END) AS SmsRating,
    MAX(CASE WHEN ps.GameType = 1 THEN ISNULL(CAST(ps.Wins AS NVARCHAR(5)) + '-' + CAST(ps.Losses AS NVARCHAR(5)), '0-0') END) AS MscRecord,
    MAX(CASE WHEN ps.GameType = 1 THEN CAST(ROUND(ps.RatingWHR + 1000, 0) AS INT) END) AS MscRating,
    MAX(CASE WHEN ps.GameType = 3 THEN ISNULL(CAST(ps.Wins AS NVARCHAR(5)) + '-' + CAST(ps.Losses AS NVARCHAR(5)), '0-0') END) AS BlRecord,
    MAX(CASE WHEN ps.GameType = 3 THEN CAST(ROUND(ps.RatingWHR + 1000, 0) AS INT) END) AS BlRating,
    MAX(CASE WHEN ps.GameType = 2 THEN ISNULL(CAST(ps.Wins2v2 AS NVARCHAR(5)) + '-' + CAST(ps.Losses2v2 AS NVARCHAR(5)), '0-0') END) AS SmsRecord2v2,
    MAX(CASE WHEN ps.GameType = 2 THEN CAST(ROUND(ps.RatingTS + 1000, 0) AS INT) END) AS SmsRating2v2,
    MAX(CASE WHEN ps.GameType = 1 THEN ISNULL(CAST(ps.Wins2v2 AS NVARCHAR(5)) + '-' + CAST(ps.Losses2v2 AS NVARCHAR(5)), '0-0') END) AS MscRecord2v2,
    MAX(CASE WHEN ps.GameType = 1 THEN CAST(ROUND(ps.RatingTS + 1000, 0) AS INT) END) AS MscRating2v2,
    MAX(CASE WHEN ps.GameType = 3 THEN ISNULL(CAST(ps.Wins2v2 AS NVARCHAR(5)) + '-' + CAST(ps.Losses2v2 AS NVARCHAR(5)), '0-0') END) AS BlRecord2v2,
    MAX(CASE WHEN ps.GameType = 3 THEN CAST(ROUND(ps.RatingTS + 1000, 0) AS INT) END) AS BlRating2v2
  FROM dbo.Player p
  LEFT JOIN dbo.PlayerStats ps ON ps.Player = p.ID AND ps.GameType IN (1, 2, 3) AND ISNULL(p.HideStats, 0) = 0
  WHERE p.ID = @playerId
  GROUP BY p.ID, p.Name;
`;

// 3: competitive ratings. Read the rating table, not the CompetitiveLeaderboard view: the view drops rows without a
// match this season, but a rating carried into the new season still belongs on the profile.
const PROFILE_COMPETITIVE_RATINGS = sql`
  SELECT rating.GameId AS GameType, rating.ModeCode AS Mode, rating.Elo, rating.RankNumber, threshold.Name AS RankName,
    rating.MatchWins, rating.MatchLosses, rating.PlacementPlayed, rating.PlacementComplete,
    rating.MatchWins + rating.MatchLosses AS TotalMatches
  FROM rocci121_toby.CompetitivePlayerRating rating
  INNER JOIN rocci121_toby.CompetitiveSeason season ON season.Id = rating.SeasonId
  INNER JOIN dbo.Player player ON player.ID = rating.PlayerId
  LEFT JOIN rocci121_toby.CompetitiveRankThreshold threshold ON threshold.RankNumber = rating.RankNumber AND threshold.IsActive = 1
  WHERE ${ACTIVE_SEASON}
    AND rating.PlayerId = @playerId
    AND player.HideStats = 0
  ORDER BY rating.GameId ASC, rating.ModeCode ASC;
`;

// 4: the highest reward level earned this season.
const PROFILE_REWARD_LEVEL = sql`
  SELECT TOP 1 ISNULL(MAX(ISNULL(progress.HighestEarnedTierOrder, 0)), 0) AS RewardLevelOrder
  FROM rocci121_toby.CompetitiveSeason season
  LEFT JOIN rocci121_toby.CompetitiveSeasonRewardProgress progress ON progress.SeasonId = season.Id AND progress.PlayerId = @playerId
  WHERE ${ACTIVE_SEASON}
  GROUP BY season.Id
  ORDER BY season.Id DESC;
`;

// 5: reward progress per game and mode.
const PROFILE_REWARD_PROGRESS = sql`
  SELECT progress.GameId, progress.ModeCode, progress.HighestEarnedTier, progress.HighestEarnedTierOrder,
    progress.CurrentTargetTier, progress.CurrentTargetTierOrder, progress.CurrentTargetWins, progress.RequiredWins
  FROM rocci121_toby.CompetitiveSeason season
  INNER JOIN rocci121_toby.CompetitiveSeasonRewardProgress progress ON progress.SeasonId = season.Id
  WHERE ${ACTIVE_SEASON}
    AND progress.PlayerId = @playerId
  ORDER BY progress.GameId ASC, progress.ModeCode ASC;
`;

// 6: tournament placements (Winner, RunnerUp and Bronze hold comma-separated player ids).
const PROFILE_ACCOLADES = sql`
  SELECT t.Name, placement.Place,
    CASE WHEN t.GameType = 1 THEN 'MSC' WHEN t.GameType = 2 THEN 'SMS' WHEN t.GameType = 3 THEN 'MSBL' ELSE '?' END AS Game,
    t.TournamentStartDate
  FROM dbo.Tournament t
  CROSS APPLY (VALUES
    (CONVERT(NVARCHAR(MAX), ISNULL(t.Winner, '')), ':first_place: '),
    (CONVERT(NVARCHAR(MAX), ISNULL(t.RunnerUp, '')), ':second_place: '),
    (CONVERT(NVARCHAR(MAX), ISNULL(t.Bronze, '')), ':third_place: ')
  ) placement(PlayerList, Place)
  WHERE (',' + REPLACE(placement.PlayerList, ' ', '') + ',') LIKE '%,' + @playerIdText + ',%'
  ORDER BY t.TournamentStartDate DESC, t.Name ASC;
`;

// 7: season awards. 2v2 awards are withheld for now: SMS 2v2 saw a single match all of Burst, which produced six
// awards off one game. Drop the ModeCode condition to bring doubles back once the mode has volume.
const PROFILE_SEASON_AWARDS = sql`
  SELECT season.DisplayName AS SeasonName, season.StartDateUtc AS SeasonStartDateUtc,
    CASE WHEN result.GameId = 1 THEN 'MSC' WHEN result.GameId = 2 THEN 'SMS' WHEN result.GameId = 3 THEN 'MSBL' ELSE '?' END AS Game,
    result.ModeCode, result.AwardCode, result.AwardName, result.RankPosition, result.MetricLabel
  FROM rocci121_toby.CompetitiveSeasonAwardResult result
  INNER JOIN rocci121_toby.CompetitiveSeasonAwardResultPlayer resultPlayer ON resultPlayer.AwardResultId = result.Id
  INNER JOIN rocci121_toby.CompetitiveSeason season ON season.Id = result.SeasonId
  WHERE resultPlayer.PlayerId = @playerId
    AND result.ModeCode = '1v1'
  ORDER BY season.StartDateUtc DESC, ${buildSeasonGameOrderCase()} ASC, result.ModeCode ASC,
    ${buildSeasonAwardOrderCase()} ASC, result.AwardCode ASC, result.RankPosition ASC;
`;

// 8: rated matches over every season, so a card stays up for anyone who has ever played the game.
const PROFILE_COMPETITIVE_HISTORY = sql`
  SELECT rating.GameId AS GameType, rating.ModeCode AS Mode, SUM(rating.MatchWins + rating.MatchLosses) AS TotalMatches
  FROM rocci121_toby.CompetitivePlayerRating rating
  INNER JOIN dbo.Player player ON player.ID = rating.PlayerId
  WHERE rating.PlayerId = @playerId
    AND player.HideStats = 0
  GROUP BY rating.GameId, rating.ModeCode;
`;

// 9 to 11: the selected title, the unlocked ones and the temporary test unlocks (titles/availability.ts decides what
// shows).
const PROFILE_TITLES = sql`
  SELECT active.TitleId AS title_id FROM dbo.PlayerActiveTitle active WHERE active.PlayerId = @playerId;
  SELECT unlock.TitleId AS title_id FROM dbo.PlayerTitleUnlock unlock WHERE unlock.PlayerId = @playerId;
  SELECT test.TitleId AS title_id FROM dbo.PlayerTitleTestUnlock test WHERE test.PlayerId = @playerId;
`;

/** A player's profile in one round trip: the result sets of PROFILE_RECORDSET, in that order. */
export function fetchPlayerProfileRecordsets(db: Queries, playerId: number): Promise<Row[][]> {
  return db.sets(sql`
    DECLARE @playerId INT = ${playerId};
    DECLARE @playerIdText NVARCHAR(20) = CONVERT(NVARCHAR(20), @playerId);
    ${PROFILE_PLAYER}
    ${PROFILE_FRIEND_CODES}
    ${PROFILE_SUMMARY}
    ${PROFILE_COMPETITIVE_RATINGS}
    ${PROFILE_REWARD_LEVEL}
    ${PROFILE_REWARD_PROGRESS}
    ${PROFILE_ACCOLADES}
    ${PROFILE_SEASON_AWARDS}
    ${PROFILE_COMPETITIVE_HISTORY}
    ${PROFILE_TITLES}
  `);
}

/**
 * Every profile with what the player list needs, and every club tag, in one round trip. Which profiles are listed,
 * and by which name, the server's member list decides (server-names.ts): the stored name is not read.
 */
export async function fetchPlayerListSource(
  db: Queries,
): Promise<{ profiles: ListProfileRecord[]; clubTags: string[] }> {
  const [profiles = [], tags = []] = (await db.sets(sql`
    SELECT p.ID AS player_id, p.DiscordID AS discord_id, p.Country AS country, p.Activity AS activity FROM dbo.Player p;
    SELECT DISTINCT LTRIM(RTRIM(c.ClanTag)) AS tag FROM dbo.Club c WHERE LTRIM(RTRIM(ISNULL(c.ClanTag, N''))) <> N'';
  `)) as [ListProfileRecord[]?, ClubTagRecord[]?];
  return { profiles, clubTags: tags.map((row) => row.tag) };
}

/**
 * Players whose stored Discord id names this account in any of the legacy forms Player.DiscordID still holds: the
 * plain id, <@id> or <@!id>, or such a mention followed by a name.
 */
export function fetchPlayersByDiscordId(db: Queries, discordId: string): Promise<DiscordPlayerRecord[]> {
  const storedForm = (form: string) => t.nvarchar(form, 256);
  return db.rows<DiscordPlayerRecord>(sql`
    SELECT p.ID AS player_id, p.Name AS name, p.Country AS country, p.IdStartGG AS id_start_gg,
      p.Activity AS activity, p.DiscordID AS discord_id, club.club_id AS club_id, club.ClubName AS club_name,
      club.ClanTag AS club_tag
    FROM dbo.Player p
    ${PLAYER_CLUB_APPLY}
    WHERE LTRIM(RTRIM(ISNULL(p.DiscordID, ''))) = ${storedForm(discordId)}
      OR LTRIM(RTRIM(ISNULL(p.DiscordID, ''))) = ${storedForm(`<@${discordId}>`)}
      OR LTRIM(RTRIM(ISNULL(p.DiscordID, ''))) = ${storedForm(`<@!${discordId}>`)}
      OR LTRIM(RTRIM(ISNULL(p.DiscordID, ''))) LIKE ${storedForm(`<@${discordId}>%`)}
      OR LTRIM(RTRIM(ISNULL(p.DiscordID, ''))) LIKE ${storedForm(`<@!${discordId}>%`)}
    ORDER BY p.ID ASC;
  `);
}
