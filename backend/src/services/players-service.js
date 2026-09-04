const { withPool, measurePool, mssql } = require("../db");
const { normalizeCountryCode } = require("./flag-codes");
const { normalizeText } = require("../lib/text");
const { normalizeDiscordId } = require("../lib/discord-id");
const { toPositiveIntId: toPositiveInt, toPositiveIntOrNull, toSafeCount } = require("../lib/numbers");
const {
  DEFAULT_ACTIVITY_WINDOW_DAYS,
  toActivityIso,
  isActivityActive,
  toIsoDateOnly
} = require("../lib/dates");
const PROFILE_SLOW_LOG_THRESHOLD_MS = 1500;
const COMPETITIVE_RANK_ICON_BASE_URL = "/assets/leaderboards/rankicons/";
const SEASON_REWARD_LEVEL_BASE_URL = "/assets/players/rewardlevel/";
const RANK_ICON_ASSET_VERSION = "20260608-rank-crop-v1";
const COMPETITIVE_UNRANKED_RANK_ICON_URL = versionAssetUrl(SEASON_REWARD_LEVEL_BASE_URL + "0-unranked.png");
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

function versionAssetUrl(url) {
  return url + "?v=" + RANK_ICON_ASSET_VERSION;
}

function normalizeCountry(value) {
  return normalizeCountryCode(value);
}

function roundOrNull(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.round(parsed);
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

function getMscRegionLabel(regionValue) {
  const region = normalizeText(regionValue).toUpperCase();
  if (region === "NTSC") {
    return "NTSC-U";
  }
  if (region === "JPN") {
    return "NTSC-J";
  }
  if (region === "KOR") {
    return "NTSC-K";
  }
  return region || "MSC";
}

function formatTwelveDigitFriendCode(value) {
  const raw = normalizeText(value);
  const digits = raw.replace(/^SW[\s-]*/i, "").replace(/\D/g, "");
  if (digits.length !== 12) {
    return raw;
  }

  return digits.slice(0, 4) + "-" + digits.slice(4, 8) + "-" + digits.slice(8, 12);
}

function formatFriendCodeValue(bucket, codeValue) {
  const code = formatTwelveDigitFriendCode(codeValue);
  if (!code) {
    return "";
  }

  if (bucket !== "switch") {
    return code;
  }

  if (/^SW-/i.test(code)) {
    return code;
  }
  return "SW-" + code;
}

function getFriendCodeSortRank(row) {
  const bucket = resolveFriendCodeBucket(row && row.GameType, row && row.Region);
  const region = normalizeText(row && row.Region).toUpperCase();
  const regionOrder = {
    PAL: 1,
    NTSC: 2,
    JPN: 3,
    KOR: 4
  };

  return [
    bucket === "switch" ? 0 : 1,
    bucket === "switch" ? 0 : regionOrder[region] || 9,
    toPositiveInt(row && row.LineSeq) || 9999
  ];
}

function compareFriendCodeRows(a, b) {
  const left = getFriendCodeSortRank(a);
  const right = getFriendCodeSortRank(b);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

function buildFriendCodes(rows) {
  const grouped = {
    switch: [],
    msc: [],
    msc_pal: [],
    msc_ntsc: [],
    msc_kor: [],
    msc_jpn: []
  };

  (Array.isArray(rows) ? rows.slice().sort(compareFriendCodeRows) : []).forEach(function (row) {
    const bucket = resolveFriendCodeBucket(row && row.GameType, row && row.Region);
    if (!bucket) {
      return;
    }

    const code = formatFriendCodeValue(bucket, row && row.Code);
    if (!code) {
      return;
    }

    if (bucket === "switch") {
      grouped.switch.push(code);
      return;
    }

    const label = normalizeText(row && row.Label);
    const line = getMscRegionLabel(row && row.Region) + (label ? " (" + label + ")" : "") + ": " + code;
    grouped.msc.push(line);
    grouped[bucket].push(line);
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

function hasCompetitiveMatches(row) {
  return toSafeCount(row && row.MatchWins) + toSafeCount(row && row.MatchLosses) > 0;
}

function getCompetitiveRankIconUrl(rankNumberValue) {
  const rankNumber = Number(rankNumberValue);
  if (rankNumber === 0) {
    return COMPETITIVE_UNRANKED_RANK_ICON_URL;
  }
  const fileName = Number.isFinite(rankNumber) ? COMPETITIVE_RANK_ICON_BY_NUMBER[rankNumber] : "";
  return fileName ? versionAssetUrl(COMPETITIVE_RANK_ICON_BASE_URL + fileName) : "";
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
    image_url: versionAssetUrl(SEASON_REWARD_LEVEL_BASE_URL + level.image)
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

function normalizePlacementProgress(competitive) {
  if (!competitive) {
    return null;
  }

  const rankNumber = Number(competitive.RankNumber);
  const placementPlayed = toSafeCount(competitive.PlacementPlayed);
  const totalMatches = toSafeCount(competitive.MatchWins) + toSafeCount(competitive.MatchLosses);
  const placementComplete = Boolean(competitive.PlacementComplete)
    || placementPlayed >= 5
    || rankNumber > 0;
  return {
    currentWins: Math.min(5, Math.max(placementPlayed, totalMatches)),
    requiredWins: 5,
    placementComplete
  };
}

function buildSeasonRewardProgressLevel(row, placementProgress) {
  const requiredWins = Math.max(1, toRewardWins(row && row.RequiredWins, 5));
  if (!row) {
    const fallbackLevel = buildSeasonRewardLevel(placementProgress && placementProgress.placementComplete ? 1 : 0);
    return Object.assign(fallbackLevel, {
      current_wins: placementProgress && !placementProgress.placementComplete
        ? Math.min(requiredWins, placementProgress.currentWins)
        : 0,
      required_wins: placementProgress ? placementProgress.requiredWins : requiredWins
    });
  }

  const highestOrder = Number(row.HighestEarnedTierOrder);
  const targetOrder = Number(row.CurrentTargetTierOrder);
  // A valid current target / earned tier is an actual reward tier (Bronze=1 … Titan=7);
  // order 0 (Unranked) is never a reward target. NB: Number(null) === 0, so the `> 0` guard
  // also treats "no current target left" (all tiers earned) as the all-earned case.
  const isTargetValid = Number.isInteger(targetOrder) && targetOrder > 0 && SEASON_REWARD_LEVEL_BY_ORDER[targetOrder];
  const isHighestEarnedTier = Number.isInteger(highestOrder) && highestOrder > 0 && SEASON_REWARD_LEVEL_BY_ORDER[highestOrder];
  const targetWins = Math.min(requiredWins, toRewardWins(row.CurrentTargetWins, placementProgress ? placementProgress.currentWins : 0));

  // A completed tier is shown at full — e.g. "Bronze 5/5" — until the next tier records its
  // first qualifying win. Completion resets the target's win count to 0 (and advances the
  // target), so "earned a tier AND the current target has no wins yet" means just-completed;
  // "no current target left" means every tier is earned. Otherwise show the in-progress tier
  // with its live win count, e.g. "Silver 2/5".
  if (isHighestEarnedTier && (!isTargetValid || targetWins === 0)) {
    const level = buildSeasonRewardLevel(highestOrder);
    return Object.assign(level, {
      current_wins: requiredWins,
      required_wins: requiredWins
    });
  }

  const level = buildSeasonRewardLevel(isTargetValid ? targetOrder : 0);
  return Object.assign(level, {
    current_wins: targetWins,
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
    season_reward_level: buildSeasonRewardProgressLevel(
      options && options.rewardProgress,
      normalizePlacementProgress(competitive)
    )
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

// Display order for season awards on player profiles, most prestigious first.
// This order is a product decision and DELIBERATELY DIFFERS from futbot's
// SEASON_AWARD_DEFINITIONS (futbot/src/utils/competitiveSeasonAwards.js), which is
// the definition order used when awards are computed - do not "resync" the two.
// What must stay in sync is the SET of codes: an award added there needs adding here.
// Codes missing from this list sort last (then alphabetically), so a newly added
// award still shows up on profiles instead of silently vanishing.
const SEASON_AWARD_DISPLAY_ORDER = [
  "TOP_10",
  "MOST_WINS",
  "SWEEP_SPECIALIST",
  "BIGGEST_UPSET",
  "CLUTCH_PLAYER",
  "COMEBACK_KING",
  "IRON_PLAYER",
  "MOST_ACTIVE",
  "DUO_OF_THE_SEASON"
];

// Games are shown MSBL -> MSC -> SMS, which is deliberately NOT GameId order
// (1 = MSC, 2 = SMS, 3 = MSBL). Unknown ids sort last.
const SEASON_AWARD_GAME_ORDER = [3, 1, 2];

// Built from the list above rather than hand-written, so the SQL can never drift from it.
function buildSeasonAwardOrderCase() {
  const whenClauses = SEASON_AWARD_DISPLAY_ORDER.map(function (code, index) {
    return "WHEN '" + code + "' THEN " + index;
  });

  return "CASE result.AwardCode " + whenClauses.join(" ")
    + " ELSE " + SEASON_AWARD_DISPLAY_ORDER.length + " END";
}

function buildSeasonGameOrderCase() {
  const whenClauses = SEASON_AWARD_GAME_ORDER.map(function (gameId, index) {
    return "WHEN " + gameId + " THEN " + index;
  });

  return "CASE result.GameId " + whenClauses.join(" ")
    + " ELSE " + SEASON_AWARD_GAME_ORDER.length + " END";
}

function buildSeasonAwardsQuery() {
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
    "  " + buildSeasonAwardOrderCase() + " ASC, result.AwardCode ASC, result.RankPosition ASC;"
  ].join(" ");
}

// Season display names are stored as "<Name> Season <Year>"; profiles show "<Name> <Year>".
// Only the standalone middle word is dropped, so a name without it survives untouched.
function formatSeasonAwardSeasonName(value) {
  return normalizeText(value).replace(/^(.*\S)\s+Season\s+(\S.*)$/i, "$1 $2");
}

// Season awards are written once, when a season is finalized, and never change afterwards.
function buildSeasonAwards(rows) {
  return (Array.isArray(rows) ? rows : []).map(function (row) {
    return {
      season_name: formatSeasonAwardSeasonName(row && row.SeasonName),
      game_code: normalizeText(row && row.Game).toUpperCase(),
      mode_code: normalizeText(row && row.ModeCode).toLowerCase(),
      award_code: normalizeText(row && row.AwardCode),
      award_name: normalizeText(row && row.AwardName),
      rank_position: toPositiveIntOrNull(row && row.RankPosition),
      metric_label: normalizeText(row && row.MetricLabel)
    };
  }).filter(function (row) {
    return row.season_name !== "" && row.award_name !== "";
  });
}

// Winning an MSL World Championship is the top honour in the scene, so profiles highlight it.
// Both halves count: the gold medal AND the event. Verified against the live tournament table -
// no tournament carries "MSL" anywhere but at the start, and there is no World Championship
// without the MSL prefix, so matching on the name is unambiguous.
const MSL_WORLD_CHAMPIONSHIP = /^MSL\b.*\bWorld Championship\b/i;

function isWorldChampionTitle(placeMedal, tournamentName) {
  return placeMedal === "🥇" && MSL_WORLD_CHAMPIONSHIP.test(String(tournamentName || ""));
}

function buildAccolades(rows) {
  return (Array.isArray(rows) ? rows : []).map(function (row) {
    const placeMedal = normalizeAccoladeMedal(row && row.Place);
    const tournamentName = normalizeText(row && row.Name);

    return {
      place_medal: placeMedal,
      game_code: normalizeText(row && row.Game).toUpperCase(),
      tournament_name: tournamentName,
      start_date: toIsoDateOnly(row && row.TournamentStartDate),
      is_world_champion: isWorldChampionTitle(placeMedal, tournamentName)
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
    "ORDER BY",
    "  CASE WHEN fc.Region = 'SW' OR fc.GameType = 3 THEN 0 ELSE 1 END,",
    "  CASE fc.Region WHEN 'PAL' THEN 1 WHEN 'NTSC' THEN 2 WHEN 'JPN' THEN 3 WHEN 'KOR' THEN 4 ELSE 9 END,",
    "  fc.LineSeq;",
    buildPlayerProfileSummaryQuery(";"),
    "SELECT",
    "  lb.GameType,",
    "  lb.Mode,",
    "  lb.Elo,",
    "  lb.RankNumber,",
    "  lb.RankName,",
    "  lb.MatchWins,",
    "  lb.MatchLosses,",
    "  lb.PlacementPlayed,",
    "  lb.PlacementComplete,",
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
    "ORDER BY t.TournamentStartDate DESC, t.Name ASC;",
    buildSeasonAwardsQuery()
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
    season_awards: buildSeasonAwards(getRecordset(recordsets, 7)),
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
  isWorldChampionTitle,
  buildSeasonAwards,
  buildSeasonAwardsQuery,
  SEASON_AWARD_DISPLAY_ORDER,
  SEASON_AWARD_GAME_ORDER,
  formatSeasonAwardSeasonName,
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
