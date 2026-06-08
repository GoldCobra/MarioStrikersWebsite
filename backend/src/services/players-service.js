const { withPool, measurePool, mssql } = require("../db");
const { normalizeCountryCode } = require("./flag-codes");
const DEFAULT_ACTIVITY_WINDOW_DAYS = 90;
const PROFILE_SLOW_LOG_THRESHOLD_MS = 1500;
const COMPETITIVE_RANK_ICON_BASE_URL = "/assets/leaderboards/rankicons/";
const SEASON_REWARD_LEVEL_BASE_URL = "/assets/players/rewardlevel/";
const COMPETITIVE_UNRANKED_RANK_ICON_URL = SEASON_REWARD_LEVEL_BASE_URL + "0-unranked.png";
const COMPETITIVE_RANK_ICON_BY_NUMBER = {
  1: "1-bronze-I.png",
  2: "1-bronze-II.png",
  3: "1-bronze-III.png",
  4: "2-silver-I.png",
  5: "2-silver-II.png",
  6: "2-silver-III.png",
  7: "3-gold-I.png",
  8: "3-gold-II.png",
  9: "3-gold-III.png",
  10: "4-platinum-I.png",
  11: "4-platinum-II.png",
  12: "4-platinum-III.png",
  13: "5-diamond-I.png",
  14: "5-diamond-II.png",
  15: "5-diamond-III.png",
  16: "6-master-I.png",
  17: "6-master-II.png",
  18: "6-master-III.png",
  19: "7-strikerstitan-b.png"
};
const SEASON_REWARD_LEVEL_BY_ORDER = {
  0: { name: "Unranked", image: "0-unranked.png" },
  1: { name: "Bronze", image: "1-bronze.png" },
  2: { name: "Silver", image: "2-silver.png" },
  3: { name: "Gold", image: "3-gold.png" },
  4: { name: "Platinum", image: "4-platinum.png" },
  5: { name: "Diamond", image: "5-diamond.png" },
  6: { name: "Master", image: "6-master.png" },
  7: { name: "Strikers Titan", image: "7-strikerstitan-b.png" }
};

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeCountry(value) {
  return normalizeCountryCode(value);
}

function normalizeDiscordId(value) {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }

  const mentionMatch = text.match(/<@!?(\d+)>/);
  if (mentionMatch) {
    return mentionMatch[1];
  }

  return /^\d+$/.test(text) ? text : "";
}

function toPositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function roundOrNull(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.round(parsed);
}

function normalizeActivityDate(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return date;
}

function toActivityIso(value) {
  const date = normalizeActivityDate(value);
  return date ? date.toISOString() : null;
}

function isActivityActive(value, now, activityWindowDays) {
  const activity = normalizeActivityDate(value);
  const reference = normalizeActivityDate(now) || new Date();
  const windowDays = Number.isFinite(Number(activityWindowDays))
    ? Number(activityWindowDays)
    : DEFAULT_ACTIVITY_WINDOW_DAYS;

  if (!activity || windowDays <= 0) {
    return false;
  }

  return reference.getTime() - activity.getTime() <= windowDays * 24 * 60 * 60 * 1000;
}

function normalizeRecordPair(value) {
  const text = normalizeText(value);
  if (!text) {
    return "-";
  }

  const match = text.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) {
    return text;
  }
  return match[1] + "-" + match[2];
}

function normalizeResultsUrl(resultsValue, idStartGG) {
  const results = normalizeText(resultsValue);
  if (results) {
    if (/^https?:\/\//i.test(results)) {
      return results;
    }
    if (/^start\.gg\//i.test(results)) {
      return "https://" + results;
    }
  }

  const startGgId = normalizeText(idStartGG).replace(/^@+/, "");
  if (!startGgId) {
    return "";
  }

  if (/^https?:\/\//i.test(startGgId)) {
    return startGgId;
  }

  return "https://start.gg/user/" + encodeURIComponent(startGgId) + "/results";
}

function discordEmojiToPngUrl(value) {
  const text = String(value || "");
  const match = text.match(/<a?:[^:>]+:(\d+)>/i);
  if (!match) {
    return "";
  }
  return "https://cdn.discordapp.com/emojis/" + match[1] + ".png?size=48&quality=lossless";
}

function normalizeAccoladeMedal(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("first") || text.includes("gold")) {
    return "🥇";
  }
  if (text.includes("second") || text.includes("silver")) {
    return "🥈";
  }
  if (text.includes("third") || text.includes("bronze")) {
    return "🥉";
  }
  return "•";
}

function resolveFriendCodeBucket(gameTypeValue, regionValue) {
  const gameType = Number(gameTypeValue);
  const region = normalizeText(regionValue).toUpperCase();

  if (gameType === 3) {
    return "switch";
  }

  if (gameType === 1) {
    if (region === "PAL") {
      return "msc_pal";
    }
    if (region === "NTSC") {
      return "msc_ntsc";
    }
    if (region === "KOR") {
      return "msc_kor";
    }
    if (region === "JPN") {
      return "msc_jpn";
    }
  }

  return "";
}

function formatFriendCodeValue(bucket, codeValue) {
  const raw = normalizeText(codeValue);
  if (!raw) {
    return "";
  }

  if (bucket !== "switch") {
    return raw;
  }

  const withoutPrefix = raw.replace(/^SW-?/i, "");
  if (/^\d{4}-\d{4}-\d{4}$/.test(withoutPrefix)) {
    return "SW-" + withoutPrefix;
  }
  if (/^SW-/i.test(raw)) {
    return raw;
  }
  return "SW-" + raw;
}

function buildFriendCodes(rows) {
  const grouped = {
    switch: [],
    msc_pal: [],
    msc_ntsc: [],
    msc_kor: [],
    msc_jpn: []
  };

  rows.forEach(function (row) {
    const bucket = resolveFriendCodeBucket(row && row.GameType, row && row.Region);
    if (!bucket) {
      return;
    }

    const code = formatFriendCodeValue(bucket, row && row.Code);
    if (!code) {
      return;
    }

    const lineSeq = toPositiveInt(row && row.LineSeq) || 1;
    const label = normalizeText(row && row.Label);
    const prefix = label || String(lineSeq);
    grouped[bucket].push(prefix + ": " + code);
  });

  return grouped;
}

function buildPlayerDisplayName(row, name) {
  const playerName = normalizeText(name);
  if (!row || row.duplicate_name !== true && Number(row.duplicate_name) !== 1) {
    return playerName;
  }

  const clubTag = normalizeText(row.club_tag);
  if (clubTag) {
    return playerName + " [" + clubTag + "]";
  }

  const playerId = toPositiveInt(row.player_id);
  return playerId ? playerName + " [#" + playerId + "]" : playerName;
}

function toPlayerListDTO(row, opts) {
  const options = opts || {};
  const name = normalizeText(row && row.name);
  if (!name) {
    return null;
  }

  return {
    player_id: Number(row && row.player_id) || null,
    name: name,
    display_name: buildPlayerDisplayName(row, name),
    country: normalizeCountry(row && row.country),
    club_id: Number(row && row.club_id) || null,
    club_name: normalizeText(row && row.club_name),
    club_tag: normalizeText(row && row.club_tag),
    activity: toActivityIso(row && row.activity),
    is_active: isActivityActive(row && row.activity, options.now, options.activityWindowDays)
  };
}

function toSafeCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.floor(parsed));
}

function hasCompetitiveMatches(row) {
  return toSafeCount(row && row.MatchWins) + toSafeCount(row && row.MatchLosses) > 0;
}

function getCompetitiveRankIconUrl(rankNumberValue) {
  const rankNumber = Number(rankNumberValue);
  if (rankNumber === 0) {
    return COMPETITIVE_UNRANKED_RANK_ICON_URL;
  }
  const fileName = Number.isFinite(rankNumber) ? COMPETITIVE_RANK_ICON_BY_NUMBER[rankNumber] : "";
  return fileName ? COMPETITIVE_RANK_ICON_BASE_URL + fileName : "";
}

function buildSeasonRewardLevel(orderValue) {
  const parsedOrder = Number(orderValue);
  const order = Number.isInteger(parsedOrder) && SEASON_REWARD_LEVEL_BY_ORDER[parsedOrder]
    ? parsedOrder
    : 0;
  const level = SEASON_REWARD_LEVEL_BY_ORDER[order] || SEASON_REWARD_LEVEL_BY_ORDER[0];

  return {
    order: order,
    name: level.name,
    image_url: SEASON_REWARD_LEVEL_BASE_URL + level.image
  };
}

function toRewardWins(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.floor(parsed));
}

function buildSeasonRewardProgressLevel(row) {
  const requiredWins = Math.max(1, toRewardWins(row && row.RequiredWins, 5));
  if (!row) {
    const unranked = buildSeasonRewardLevel(0);
    return Object.assign(unranked, {
      current_wins: 0,
      required_wins: requiredWins
    });
  }

  const targetOrder = Number(row.CurrentTargetTierOrder);
  const highestOrder = Number(row.HighestEarnedTierOrder);
  const hasTargetOrder = row.CurrentTargetTierOrder !== null && row.CurrentTargetTierOrder !== undefined && row.CurrentTargetTierOrder !== "";
  const isTargetValid = hasTargetOrder && Number.isInteger(targetOrder) && SEASON_REWARD_LEVEL_BY_ORDER[targetOrder];
  const isCompletedTitan = !isTargetValid && Number.isInteger(highestOrder) && highestOrder >= 7;
  const order = isTargetValid
    ? targetOrder
    : (isCompletedTitan ? 7 : 0);
  const level = buildSeasonRewardLevel(order);
  const currentWins = isCompletedTitan
    ? requiredWins
    : Math.min(requiredWins, toRewardWins(row.CurrentTargetWins, 0));

  return Object.assign(level, {
    current_wins: currentWins,
    required_wins: requiredWins
  });
}

function buildCompetitiveRatingsByKey(rows) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach(function (row) {
    const gameType = Number(row && row.GameType);
    const mode = normalizeText(row && row.Mode).toLowerCase();
    if (!gameType || !mode) {
      return;
    }
    map.set(String(gameType) + ":" + mode, row);
  });
  return map;
}

function getCompetitiveRating(competitiveRatingsByKey, gameType, mode) {
  if (!competitiveRatingsByKey || typeof competitiveRatingsByKey.get !== "function") {
    return null;
  }
  return competitiveRatingsByKey.get(String(gameType) + ":" + String(mode || "").toLowerCase()) || null;
}

function buildRewardProgressByKey(rows) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach(function (row) {
    const gameId = Number(row && row.GameId);
    const mode = normalizeText(row && row.ModeCode).toLowerCase();
    if (!gameId || !mode) {
      return;
    }
    map.set(String(gameId) + ":" + mode, row);
  });
  return map;
}

function getRewardProgress(rewardProgressByKey, gameType, mode) {
  if (!rewardProgressByKey || typeof rewardProgressByKey.get !== "function") {
    return null;
  }
  return rewardProgressByKey.get(String(gameType) + ":" + String(mode || "").toLowerCase()) || null;
}

function buildRatingBlock(options) {
  const competitive = options && options.competitive;
  if (!hasCompetitiveMatches(competitive)) {
    return {};
  }

  const metricName = String(options && options.metricName || "").trim();
  const metricValue = roundOrNull(options && options.metricValue);
  const rankNumber = Number(competitive && competitive.RankNumber);
  const wins = toSafeCount(competitive && competitive.MatchWins);
  const losses = toSafeCount(competitive && competitive.MatchLosses);

  const result = {
    rating: roundOrNull(competitive && competitive.Elo),
    sets: wins + "-" + losses,
    games: normalizeRecordPair(options && options.games),
    rank_emoji: "",
    rank_icon_url: getCompetitiveRankIconUrl(rankNumber),
    competitive_rank: normalizeText(competitive && competitive.RankName),
    competitive_rank_number: Number.isFinite(rankNumber) ? rankNumber : null,
    season_reward_level: buildSeasonRewardProgressLevel(options && options.rewardProgress)
  };

  if (metricName) {
    result[metricName] = metricValue;
  }

  return result;
}

function buildRatings(profile, competitiveRatings, rewardProgressRows) {
  const competitiveRatingsByKey = buildCompetitiveRatingsByKey(competitiveRatings);
  const rewardProgressByKey = buildRewardProgressByKey(rewardProgressRows);
  return {
    sms: buildRatingBlock({
      competitive: getCompetitiveRating(competitiveRatingsByKey, 2, "1v1"),
      rewardProgress: getRewardProgress(rewardProgressByKey, 2, "1v1"),
      games: profile && profile.SmsRecord,
      metricName: "whr",
      metricValue: profile && profile.SmsRating
    }),
    msc: buildRatingBlock({
      competitive: getCompetitiveRating(competitiveRatingsByKey, 1, "1v1"),
      rewardProgress: getRewardProgress(rewardProgressByKey, 1, "1v1"),
      games: profile && profile.MscRecord,
      metricName: "whr",
      metricValue: profile && profile.MscRating
    }),
    msbl: buildRatingBlock({
      competitive: getCompetitiveRating(competitiveRatingsByKey, 3, "1v1"),
      rewardProgress: getRewardProgress(rewardProgressByKey, 3, "1v1"),
      games: profile && profile.BlRecord,
      metricName: "whr",
      metricValue: profile && profile.BlRating
    }),
    sms2v2: buildRatingBlock({
      competitive: getCompetitiveRating(competitiveRatingsByKey, 2, "2v2"),
      rewardProgress: getRewardProgress(rewardProgressByKey, 2, "2v2"),
      games: profile && profile.SmsRecord2v2,
      metricName: "tst",
      metricValue: profile && profile.SmsRating2v2
    }),
    msc2v2: buildRatingBlock({
      competitive: getCompetitiveRating(competitiveRatingsByKey, 1, "2v2"),
      rewardProgress: getRewardProgress(rewardProgressByKey, 1, "2v2"),
      games: profile && profile.MscRecord2v2,
      metricName: "tst",
      metricValue: profile && profile.MscRating2v2
    }),
    msbl2v2: buildRatingBlock({
      competitive: getCompetitiveRating(competitiveRatingsByKey, 3, "2v2"),
      rewardProgress: getRewardProgress(rewardProgressByKey, 3, "2v2"),
      games: profile && profile.BlRecord2v2,
      metricName: "tst",
      metricValue: profile && profile.BlRating2v2
    })
  };
}

function toIsoDateOnly(value) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

async function getPlayerBaseById(pool, playerId) {
  const request = pool.request();
  request.input("playerId", mssql.Int, playerId);
  const result = await request.query(
    [
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
      "OUTER APPLY (",
      "  SELECT TOP 1 c.ID AS club_id, c.ClubName, c.ClanTag",
      "  FROM ClubRoster cr",
      "  INNER JOIN Club c ON c.ID = cr.Club",
      "  WHERE cr.Player = p.ID",
      "  ORDER BY ISNULL(cr.Rank, 9999), c.ClubName",
      ") club",
      "WHERE p.ID = @playerId"
    ].join(" ")
  );

  const row = Array.isArray(result && result.recordset) ? result.recordset[0] : null;
  const name = normalizeText(row && row.name);
  if (!row || !name) {
    return null;
  }

  return {
    player_id: Number(row.player_id) || null,
    name: name,
    country: normalizeCountry(row.country),
    id_start_gg: normalizeText(row.id_start_gg),
    club_id: Number(row.club_id) || null,
    club_name: normalizeText(row.club_name),
    club_tag: normalizeText(row.club_tag),
    activity: row.activity || null
  };
}

async function getPlayerBaseByDiscordId(pool, discordIdRaw) {
  const discordId = normalizeDiscordId(discordIdRaw);
  if (!discordId) {
    throw new Error("Invalid Discord user id.");
  }

  const request = pool.request();
  request.input("discordId", mssql.NVarChar(256), discordId);
  request.input("discordMention", mssql.NVarChar(256), "<@" + discordId + ">");
  request.input("discordMentionBang", mssql.NVarChar(256), "<@!" + discordId + ">");
  request.input("discordMentionPrefix", mssql.NVarChar(256), "<@" + discordId + ">%");
  request.input("discordMentionBangPrefix", mssql.NVarChar(256), "<@!" + discordId + ">%");
  const result = await request.query(
    [
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
      "OUTER APPLY (",
      "  SELECT TOP 1 c.ID AS club_id, c.ClubName, c.ClanTag",
      "  FROM ClubRoster cr",
      "  INNER JOIN Club c ON c.ID = cr.Club",
      "  WHERE cr.Player = p.ID",
      "  ORDER BY ISNULL(cr.Rank, 9999), c.ClubName",
      ") club",
      "WHERE",
      "  LTRIM(RTRIM(ISNULL(p.DiscordID, ''))) = @discordId",
      "  OR LTRIM(RTRIM(ISNULL(p.DiscordID, ''))) = @discordMention",
      "  OR LTRIM(RTRIM(ISNULL(p.DiscordID, ''))) = @discordMentionBang",
      "  OR LTRIM(RTRIM(ISNULL(p.DiscordID, ''))) LIKE @discordMentionPrefix",
      "  OR LTRIM(RTRIM(ISNULL(p.DiscordID, ''))) LIKE @discordMentionBangPrefix",
      "ORDER BY p.ID ASC"
    ].join(" ")
  );

  const rows = Array.isArray(result && result.recordset) ? result.recordset : [];
  const exactRows = rows.filter(function (row) {
    return normalizeDiscordId(row && row.discord_id) === discordId && normalizeText(row && row.name);
  });

  if (exactRows.length === 0) {
    return null;
  }

  if (exactRows.length > 1) {
    const error = new Error("Multiple player profiles match this Discord account.");
    error.code = "PLAYER_PROFILE_CONFLICT";
    throw error;
  }

  const row = exactRows[0];
  return {
    player_id: Number(row.player_id) || null,
    name: normalizeText(row.name),
    country: normalizeCountry(row.country),
    id_start_gg: normalizeText(row.id_start_gg),
    club_id: Number(row.club_id) || null,
    club_name: normalizeText(row.club_name),
    club_tag: normalizeText(row.club_tag),
    activity: row.activity || null
  };
}

async function getPlayerFriendCodes(pool, playerId) {
  const request = pool.request();
  request.input("playerId", mssql.Int, playerId);
  const result = await request.query(
    [
      "SELECT",
      "  fc.GameType,",
      "  fc.Region,",
      "  fc.LineSeq,",
      "  fc.Label,",
      "  fc.Code",
      "FROM FriendCodes fc",
      "WHERE fc.Player = @playerId",
      "ORDER BY fc.GameType, fc.Region, fc.LineSeq"
    ].join(" ")
  );

  const rows = Array.isArray(result && result.recordset) ? result.recordset : [];
  return buildFriendCodes(rows);
}

function buildPlayerProfileSummaryQuery(terminator) {
  const suffix = terminator || "";
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
    "GROUP BY p.ID, p.Name" + suffix
  ].join(" ");
}

async function getPlayerProfileSummary(pool, playerId) {
  const request = pool.request();
  request.input("playerId", mssql.Int, playerId);
  const result = await request.query(buildPlayerProfileSummaryQuery());
  const rows = Array.isArray(result && result.recordset) ? result.recordset : [];
  return rows[0] || null;
}

async function getPlayerCompetitiveRatings(pool, playerId) {
  const request = pool.request();
  request.input("playerId", mssql.Int, playerId);
  const result = await request.query(
    [
      "SELECT",
      "  lb.GameType,",
      "  lb.Mode,",
      "  lb.Elo,",
      "  lb.RankNumber,",
      "  lb.RankName,",
      "  lb.MatchWins,",
      "  lb.MatchLosses,",
      "  lb.TotalMatches",
      "FROM CompetitiveLeaderboard lb",
      "INNER JOIN CompetitiveSeason season ON season.Id = lb.SeasonId",
      "WHERE season.IsActive = 1",
      "  AND season.LifecycleStatus = 'active'",
      "  AND lb.PlayerId = @playerId",
      "ORDER BY lb.GameType ASC, lb.Mode ASC"
    ].join(" ")
  );
  return Array.isArray(result && result.recordset) ? result.recordset : [];
}

function buildSeasonRewardLevelQuery() {
  return [
    "SELECT TOP 1",
    "  ISNULL(MAX(ISNULL(progress.HighestEarnedTierOrder, 0)), 0) AS RewardLevelOrder",
    "FROM CompetitiveSeason season",
    "LEFT JOIN CompetitiveSeasonRewardProgress progress ON progress.SeasonId = season.Id AND progress.PlayerId = @playerId",
    "WHERE season.IsActive = 1",
    "  AND season.LifecycleStatus = 'active'",
    "GROUP BY season.Id",
    "ORDER BY season.Id DESC"
  ].join(" ");
}

function buildAccolades(rows) {
  return (Array.isArray(rows) ? rows : []).map(function (row) {
    return {
      place_medal: normalizeAccoladeMedal(row && row.Place),
      game_code: normalizeText(row && row.Game).toUpperCase(),
      tournament_name: normalizeText(row && row.Name),
      start_date: toIsoDateOnly(row && row.TournamentStartDate)
    };
  }).filter(function (row) {
    return row.tournament_name !== "";
  }).sort(function (a, b) {
    var dateA = String(a.start_date || "");
    var dateB = String(b.start_date || "");
    if (dateA && dateB && dateA !== dateB) {
      return dateB.localeCompare(dateA);
    }
    return String(a.tournament_name || "").localeCompare(String(b.tournament_name || ""));
  });
}

async function getPlayerSeasonRewardLevel(pool, playerId) {
  const request = pool.request();
  request.input("playerId", mssql.Int, playerId);
  const result = await request.query(buildSeasonRewardLevelQuery());
  const row = Array.isArray(result && result.recordset) ? result.recordset[0] : null;
  return buildSeasonRewardLevel(row && row.RewardLevelOrder);
}

async function getPlayerAccolades(pool, playerId) {
  const request = pool.request();
  request.input("playerId", mssql.Int, playerId);
  const result = await request.query(
    [
      "DECLARE @playerIdText NVARCHAR(20) = CONVERT(NVARCHAR(20), @playerId);",
      "SELECT t.Name, ':first_place: ' AS Place, CASE WHEN t.GameType = 1 THEN 'MSC' WHEN t.GameType = 2 THEN 'SMS' WHEN t.GameType = 3 THEN 'MSBL' ELSE '?' END AS Game, t.TournamentStartDate",
      "FROM Tournament t",
      "WHERE (',' + REPLACE(CONVERT(NVARCHAR(MAX), ISNULL(t.Winner, '')), ' ', '') + ',') LIKE '%,' + @playerIdText + ',%'",
      "UNION ALL",
      "SELECT t.Name, ':second_place: ' AS Place, CASE WHEN t.GameType = 1 THEN 'MSC' WHEN t.GameType = 2 THEN 'SMS' WHEN t.GameType = 3 THEN 'MSBL' ELSE '?' END AS Game, t.TournamentStartDate",
      "FROM Tournament t",
      "WHERE (',' + REPLACE(CONVERT(NVARCHAR(MAX), ISNULL(t.RunnerUp, '')), ' ', '') + ',') LIKE '%,' + @playerIdText + ',%'",
      "UNION ALL",
      "SELECT t.Name, ':third_place: ' AS Place, CASE WHEN t.GameType = 1 THEN 'MSC' WHEN t.GameType = 2 THEN 'SMS' WHEN t.GameType = 3 THEN 'MSBL' ELSE '?' END AS Game, t.TournamentStartDate",
      "FROM Tournament t",
      "WHERE (',' + REPLACE(CONVERT(NVARCHAR(MAX), ISNULL(t.Bronze, '')), ' ', '') + ',') LIKE '%,' + @playerIdText + ',%'",
      "ORDER BY TournamentStartDate DESC"
    ].join(" ")
  );
  const rows = Array.isArray(result && result.recordset) ? result.recordset : [];

  return buildAccolades(rows);
}

function buildPlayerProfileBatchQuery() {
  return [
    "DECLARE @playerIdText NVARCHAR(20) = CONVERT(NVARCHAR(20), @playerId);",
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
    "OUTER APPLY (",
    "  SELECT TOP 1 c.ID AS club_id, c.ClubName, c.ClanTag",
    "  FROM ClubRoster cr",
    "  INNER JOIN Club c ON c.ID = cr.Club",
    "  WHERE cr.Player = p.ID",
    "  ORDER BY ISNULL(cr.Rank, 9999), c.ClubName",
    ") club",
    "WHERE p.ID = @playerId;",
    "SELECT",
    "  fc.GameType,",
    "  fc.Region,",
    "  fc.LineSeq,",
    "  fc.Label,",
    "  fc.Code",
    "FROM FriendCodes fc",
    "WHERE fc.Player = @playerId",
    "ORDER BY fc.GameType, fc.Region, fc.LineSeq;",
    buildPlayerProfileSummaryQuery(";"),
    "SELECT",
    "  lb.GameType,",
    "  lb.Mode,",
    "  lb.Elo,",
    "  lb.RankNumber,",
    "  lb.RankName,",
    "  lb.MatchWins,",
    "  lb.MatchLosses,",
    "  lb.TotalMatches",
    "FROM CompetitiveLeaderboard lb",
    "INNER JOIN CompetitiveSeason season ON season.Id = lb.SeasonId",
    "WHERE season.IsActive = 1",
    "  AND season.LifecycleStatus = 'active'",
    "  AND lb.PlayerId = @playerId",
    "ORDER BY lb.GameType ASC, lb.Mode ASC;",
    "SELECT TOP 1",
    "  ISNULL(MAX(ISNULL(progress.HighestEarnedTierOrder, 0)), 0) AS RewardLevelOrder",
    "FROM CompetitiveSeason season",
    "LEFT JOIN CompetitiveSeasonRewardProgress progress ON progress.SeasonId = season.Id AND progress.PlayerId = @playerId",
    "WHERE season.IsActive = 1",
    "  AND season.LifecycleStatus = 'active'",
    "GROUP BY season.Id",
    "ORDER BY season.Id DESC;",
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
    "WHERE season.IsActive = 1",
    "  AND season.LifecycleStatus = 'active'",
    "  AND progress.PlayerId = @playerId",
    "ORDER BY progress.GameId ASC, progress.ModeCode ASC;",
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
    "ORDER BY t.TournamentStartDate DESC, t.Name ASC;"
  ].join(" ");
}

function getRecordset(recordsets, index) {
  return Array.isArray(recordsets && recordsets[index]) ? recordsets[index] : [];
}

function buildPlayerProfileFromRecordsets(recordsets) {
  const baseRows = getRecordset(recordsets, 0);
  const playerRow = baseRows[0] || null;
  const name = normalizeText(playerRow && playerRow.name);
  if (!playerRow || !name) {
    return null;
  }

  const player = {
    player_id: Number(playerRow.player_id) || null,
    name: name,
    country: normalizeCountry(playerRow.country),
    id_start_gg: normalizeText(playerRow.id_start_gg),
    club_id: Number(playerRow.club_id) || null,
    club_name: normalizeText(playerRow.club_name),
    club_tag: normalizeText(playerRow.club_tag),
    activity: playerRow.activity || null
  };
  const profileData = getRecordset(recordsets, 2)[0] || {};
  const rewardRow = getRecordset(recordsets, 4)[0] || null;

  return {
    player: {
      id: player.player_id,
      name: player.name,
      country: player.country,
      club_id: player.club_id,
      club_name: player.club_name,
      club_tag: player.club_tag,
      results_url: normalizeResultsUrl(profileData.ResultsStartGG, player.id_start_gg),
      activity: toActivityIso(player.activity),
      is_active: isActivityActive(player.activity)
    },
    friend_codes: buildFriendCodes(getRecordset(recordsets, 1)),
    accolades: buildAccolades(getRecordset(recordsets, 6)),
    ratings: buildRatings(profileData, getRecordset(recordsets, 3), getRecordset(recordsets, 5)),
    season_reward_level: buildSeasonRewardLevel(rewardRow && rewardRow.RewardLevelOrder),
    highest_rank_banner_url: ""
  };
}

async function getPlayerProfileBatch(pool, playerId) {
  const request = pool.request();
  request.multiple = true;
  request.input("playerId", mssql.Int, playerId);
  const startedAt = Date.now();
  const result = await request.query(buildPlayerProfileBatchQuery());
  return {
    recordsets: Array.isArray(result && result.recordsets) ? result.recordsets : [],
    dbMs: Date.now() - startedAt
  };
}

function logSlowProfileLoad(playerId, totalMs, dbMs, poolMs, recordsets) {
  if (totalMs < PROFILE_SLOW_LOG_THRESHOLD_MS) {
    return;
  }

  const counts = (Array.isArray(recordsets) ? recordsets : []).map(function (rows) {
    return Array.isArray(rows) ? rows.length : 0;
  });
  console.warn("[players-profile] slow profile load", JSON.stringify({
    playerId: playerId,
    totalMs: totalMs,
    poolMs: poolMs,
    queryMs: dbMs,
    dbMs: dbMs,
    recordsetCounts: counts
  }));
}

function buildPlayersListQuery() {
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
    "OUTER APPLY (",
    "  SELECT TOP 1 c.ID AS club_id, c.ClubName, c.ClanTag",
    "  FROM ClubRoster cr",
    "  INNER JOIN Club c ON c.ID = cr.Club",
    "  WHERE cr.Player = p.ID",
    "  ORDER BY ISNULL(cr.Rank, 9999), c.ClubName",
    ") club",
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
    "  LTRIM(RTRIM(ISNULL(p.Name, ''))) ASC"
  ].join(" ");
}

async function getPlayersList() {
  return withPool(async function (pool) {
    const result = await pool.request().query(buildPlayersListQuery());

    const rows = Array.isArray(result && result.recordset) ? result.recordset : [];

    return rows
      .map(function (row) {
        return toPlayerListDTO(row);
      })
      .filter(Boolean);
  });
}

async function buildPlayerProfile(pool, player, poolMs) {
  const playerId = toPositiveInt(player && player.player_id);
  if (!playerId) {
    throw new Error("Player not found.");
  }

  const profile = await getPlayerProfileByIdFromPool(pool, playerId, poolMs);
  if (!profile) {
    throw new Error("Player not found.");
  }
  return profile;
}

async function getPlayerProfileByIdFromPool(pool, playerId, poolMs) {
  const startedAt = Date.now();
  const batch = await getPlayerProfileBatch(pool, playerId);
  const profile = buildPlayerProfileFromRecordsets(batch.recordsets);
  logSlowProfileLoad(playerId, Date.now() - startedAt + Number(poolMs || 0), batch.dbMs, Number(poolMs || 0), batch.recordsets);
  return profile;
}

async function getPlayerProfile(playerIdRaw) {
  const playerId = toPositiveInt(playerIdRaw);
  if (!playerId) {
    throw new Error("Invalid player id.");
  }

  return measurePool(async function (pool, poolMs) {
    const profile = await getPlayerProfileByIdFromPool(pool, playerId, poolMs);
    if (!profile) {
      throw new Error("Player not found.");
    }
    return profile;
  });
}

async function getPlayerProfileByDiscordId(discordIdRaw) {
  return measurePool(async function (pool, poolMs) {
    const player = await getPlayerBaseByDiscordId(pool, discordIdRaw);
    if (!player) {
      return null;
    }

    return buildPlayerProfile(pool, player, poolMs);
  });
}

module.exports = {
  DEFAULT_ACTIVITY_WINDOW_DAYS,
  buildAccolades,
  buildCompetitiveRatingsByKey,
  buildPlayerProfileBatchQuery,
  buildPlayerProfileFromRecordsets,
  buildPlayersListQuery,
  buildRatingBlock,
  buildRatings,
  buildSeasonRewardLevel,
  buildSeasonRewardLevelQuery,
  buildPlayerDisplayName,
  getPlayersList,
  getPlayerProfile,
  getPlayerProfileByDiscordId,
  isActivityActive,
  normalizeCountry,
  normalizeDiscordId,
  toActivityIso,
  toPlayerListDTO
};
