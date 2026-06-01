const { withPool, mssql } = require("../db");
const DEFAULT_ACTIVITY_WINDOW_DAYS = 90;

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeCountry(value) {
  const country = normalizeText(value).toLowerCase();
  if (!/^[a-z]{2}$/.test(country)) {
    return "";
  }
  return country;
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

function buildRatingBlock(options) {
  const rawRankEmoji = normalizeText(options && options.rankEmoji);
  const metricName = String(options && options.metricName || "").trim();
  const metricValue = roundOrNull(options && options.metricValue);

  const result = {
    rating: roundOrNull(options && options.rating),
    sets: normalizeRecordPair(options && options.sets),
    games: normalizeRecordPair(options && options.games),
    rank_emoji: rawRankEmoji,
    rank_icon_url: discordEmojiToPngUrl(rawRankEmoji)
  };

  if (metricName) {
    result[metricName] = metricValue;
  }

  return result;
}

function buildRatings(profile) {
  return {
    sms: buildRatingBlock({
      rating: profile && profile.SmsElo,
      sets: profile && profile.SmsMatchRecord,
      games: profile && profile.SmsRecord,
      metricName: "whr",
      metricValue: profile && profile.SmsRating,
      rankEmoji: profile && profile.SmsRank
    }),
    msc: buildRatingBlock({
      rating: profile && profile.MscElo,
      sets: profile && profile.MscMatchRecord,
      games: profile && profile.MscRecord,
      metricName: "whr",
      metricValue: profile && profile.MscRating,
      rankEmoji: profile && profile.MscRank
    }),
    msbl: buildRatingBlock({
      rating: profile && profile.BlElo,
      sets: profile && profile.BlMatchRecord,
      games: profile && profile.BlRecord,
      metricName: "whr",
      metricValue: profile && profile.BlRating,
      rankEmoji: profile && profile.BlRank
    }),
    sms2v2: buildRatingBlock({
      rating: profile && profile.SmsElo2v2,
      sets: profile && profile.SmsMatchRecord2v2,
      games: profile && profile.SmsRecord2v2,
      metricName: "tst",
      metricValue: profile && profile.SmsRating2v2,
      rankEmoji: profile && profile.SmsRank2v2
    }),
    msc2v2: buildRatingBlock({
      rating: profile && profile.MscElo2v2,
      sets: profile && profile.MscMatchRecord2v2,
      games: profile && profile.MscRecord2v2,
      metricName: "tst",
      metricValue: profile && profile.MscRating2v2,
      rankEmoji: profile && profile.MscRank2v2
    }),
    msbl2v2: buildRatingBlock({
      rating: profile && profile.BlElo2v2,
      sets: profile && profile.BlMatchRecord2v2,
      games: profile && profile.BlRecord2v2,
      metricName: "tst",
      metricValue: profile && profile.BlRating2v2,
      rankEmoji: profile && profile.BlRank2v2
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

async function getPlayerProfileSummary(pool, playerId) {
  const request = pool.request();
  request.input("playerId", mssql.Int, playerId);
  const result = await request.query(
    [
      "SELECT TOP 1",
      "  p.Name,",
      "  c.ClubName AS Club,",
      "  ISNULL(CAST(sms.Wins AS NVARCHAR(5)) + '-' + CAST(sms.Losses AS NVARCHAR(5)), '0-0') AS SmsRecord,",
      "  ISNULL(CAST(sms.MatchWins AS NVARCHAR(5)) + '-' + CAST(sms.MatchLosses AS NVARCHAR(5)), '0-0') AS SmsMatchRecord,",
      "  CAST(ROUND(sms.RatingWHR + 1000, 0) AS INT) AS SmsRating,",
      "  CAST(ROUND(sms.Elo, 0) AS INT) AS SmsElo,",
      "  smsRank.Value AS SmsRank,",
      "  ISNULL(CAST(msc.Wins AS NVARCHAR(5)) + '-' + CAST(msc.Losses AS NVARCHAR(5)), '0-0') AS MscRecord,",
      "  ISNULL(CAST(msc.MatchWins AS NVARCHAR(5)) + '-' + CAST(msc.MatchLosses AS NVARCHAR(5)), '0-0') AS MscMatchRecord,",
      "  CAST(ROUND(msc.RatingWHR + 1000, 0) AS INT) AS MscRating,",
      "  CAST(ROUND(msc.Elo, 0) AS INT) AS MscElo,",
      "  mscRank.Value AS MscRank,",
      "  ISNULL(CAST(bl.Wins AS NVARCHAR(5)) + '-' + CAST(bl.Losses AS NVARCHAR(5)), '0-0') AS BlRecord,",
      "  ISNULL(CAST(bl.MatchWins AS NVARCHAR(5)) + '-' + CAST(bl.MatchLosses AS NVARCHAR(5)), '0-0') AS BlMatchRecord,",
      "  CAST(ROUND(bl.RatingWHR + 1000, 0) AS INT) AS BlRating,",
      "  CAST(ROUND(bl.Elo, 0) AS INT) AS BlElo,",
      "  blRank.Value AS BlRank,",
      "  ISNULL(CAST(sms.Wins2v2 AS NVARCHAR(5)) + '-' + CAST(sms.Losses2v2 AS NVARCHAR(5)), '0-0') AS SmsRecord2v2,",
      "  ISNULL(CAST(sms.MatchWins2v2 AS NVARCHAR(5)) + '-' + CAST(sms.MatchLosses2v2 AS NVARCHAR(5)), '0-0') AS SmsMatchRecord2v2,",
      "  CAST(ROUND(sms.RatingTS + 1000, 0) AS INT) AS SmsRating2v2,",
      "  CAST(ROUND(sms.Elo2, 0) AS INT) AS SmsElo2v2,",
      "  smsRank2v2.Value AS SmsRank2v2,",
      "  ISNULL(CAST(msc.Wins2v2 AS NVARCHAR(5)) + '-' + CAST(msc.Losses2v2 AS NVARCHAR(5)), '0-0') AS MscRecord2v2,",
      "  ISNULL(CAST(msc.MatchWins2v2 AS NVARCHAR(5)) + '-' + CAST(msc.MatchLosses2v2 AS NVARCHAR(5)), '0-0') AS MscMatchRecord2v2,",
      "  CAST(ROUND(msc.RatingTS + 1000, 0) AS INT) AS MscRating2v2,",
      "  CAST(ROUND(msc.Elo2, 0) AS INT) AS MscElo2v2,",
      "  mscRank2v2.Value AS MscRank2v2,",
      "  ISNULL(CAST(bl.Wins2v2 AS NVARCHAR(5)) + '-' + CAST(bl.Losses2v2 AS NVARCHAR(5)), '0-0') AS BlRecord2v2,",
      "  ISNULL(CAST(bl.MatchWins2v2 AS NVARCHAR(5)) + '-' + CAST(bl.MatchLosses2v2 AS NVARCHAR(5)), '0-0') AS BlMatchRecord2v2,",
      "  CAST(ROUND(bl.RatingTS + 1000, 0) AS INT) AS BlRating2v2,",
      "  CAST(ROUND(bl.Elo2, 0) AS INT) AS BlElo2v2,",
      "  blRank2v2.Value AS BlRank2v2,",
      "  ISNULL(zest.Description, '') AS RankImage",
      "FROM Player p",
      "LEFT JOIN PlayerStats sms ON p.ID = sms.Player AND sms.GameType = 2 AND ISNULL(p.HideStats, 0) = 0",
      "LEFT JOIN Enumeration smsRank ON sms.Rank = smsRank.Code AND smsRank.Type = 'emoji'",
      "LEFT JOIN Enumeration smsRank2v2 ON sms.Rank2v2 = smsRank2v2.Code AND smsRank2v2.Type = 'emoji'",
      "LEFT JOIN PlayerStats msc ON p.ID = msc.Player AND msc.GameType = 1 AND ISNULL(p.HideStats, 0) = 0",
      "LEFT JOIN Enumeration mscRank ON msc.Rank = mscRank.Code AND mscRank.Type = 'emoji'",
      "LEFT JOIN Enumeration mscRank2v2 ON msc.Rank2v2 = mscRank2v2.Code AND mscRank2v2.Type = 'emoji'",
      "LEFT JOIN PlayerStats bl ON p.ID = bl.Player AND bl.GameType = 3 AND ISNULL(p.HideStats, 0) = 0",
      "LEFT JOIN Enumeration blRank ON bl.Rank = blRank.Code AND blRank.Type = 'emoji'",
      "LEFT JOIN Enumeration blRank2v2 ON bl.Rank2v2 = blRank2v2.Code AND blRank2v2.Type = 'emoji'",
      "LEFT JOIN ClubRoster roster ON p.ID = roster.Player",
      "LEFT JOIN Club c ON roster.Club = c.ID",
      "LEFT JOIN (",
      "  SELECT Player, ((MAX(CASE WHEN ISNULL(IsActive2v2, 0) * ISNULL(Rank2v2, 0) > ISNULL(IsActive, 0) * ISNULL(Rank, 0) THEN ISNULL(IsActive2v2, 0) * ISNULL(Rank2v2, 0) ELSE ISNULL(IsActive, 0) * ISNULL(Rank, 0) END) - 1) / 3) + 1 AS rankrole",
      "  FROM PlayerStats",
      "  GROUP BY Player",
      "  HAVING MAX(CASE WHEN ISNULL(IsActive2v2, 0) * ISNULL(Rank2v2, 0) > ISNULL(IsActive, 0) * ISNULL(Rank, 0) THEN ISNULL(IsActive2v2, 0) * ISNULL(Rank2v2, 0) ELSE ISNULL(IsActive, 0) * ISNULL(Rank, 0) END) > 0",
      ") maxRank ON p.ID = maxRank.Player",
      "LEFT JOIN Enumeration zest ON zest.Type = 'ProfileZest' AND maxRank.rankrole = zest.Code",
      "WHERE p.ID = @playerId",
      "ORDER BY ISNULL(roster.Rank, 9999), c.ClubName"
    ].join(" ")
  );
  const rows = Array.isArray(result && result.recordset) ? result.recordset : [];
  return rows[0] || null;
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

  return rows.map(function (row) {
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

async function getPlayersList() {
  return withPool(async function (pool) {
    const result = await pool.request().query(
      [
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
        "  AND EXISTS (",
        "    SELECT 1",
        "    FROM PlayerStats ps",
        "    WHERE ps.Player = p.ID",
        "      AND (",
        "        ISNULL(ps.Wins, 0) > 0",
        "        OR ISNULL(ps.Losses, 0) > 0",
        "        OR ISNULL(ps.MatchDraws, 0) > 0",
        "      )",
        "  )",
        "ORDER BY",
        "  LOWER(LTRIM(RTRIM(ISNULL(p.Name, '')))) ASC,",
        "  LTRIM(RTRIM(ISNULL(p.Name, ''))) ASC"
      ].join(" ")
    );

    const rows = Array.isArray(result && result.recordset) ? result.recordset : [];

    return rows
      .map(function (row) {
        return toPlayerListDTO(row);
      })
      .filter(Boolean);
  });
}

async function buildPlayerProfile(pool, player) {
  const playerId = toPositiveInt(player && player.player_id);
  if (!playerId) {
    throw new Error("Player not found.");
  }

  const [friendCodes, profile, accolades] = await Promise.all([
    getPlayerFriendCodes(pool, playerId),
    getPlayerProfileSummary(pool, playerId),
    getPlayerAccolades(pool, playerId)
  ]);

  const profileData = profile || {};

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
    friend_codes: friendCodes,
    accolades: accolades,
    ratings: buildRatings(profileData),
    highest_rank_banner_url: normalizeText(profileData.RankImage)
  };
}

async function getPlayerProfile(playerIdRaw) {
  const playerId = toPositiveInt(playerIdRaw);
  if (!playerId) {
    throw new Error("Invalid player id.");
  }

  return withPool(async function (pool) {
    const player = await getPlayerBaseById(pool, playerId);
    if (!player) {
      throw new Error("Player not found.");
    }

    return buildPlayerProfile(pool, player);
  });
}

async function getPlayerProfileByDiscordId(discordIdRaw) {
  return withPool(async function (pool) {
    const player = await getPlayerBaseByDiscordId(pool, discordIdRaw);
    if (!player) {
      return null;
    }

    return buildPlayerProfile(pool, player);
  });
}

module.exports = {
  DEFAULT_ACTIVITY_WINDOW_DAYS,
  buildPlayerDisplayName,
  getPlayersList,
  getPlayerProfile,
  getPlayerProfileByDiscordId,
  isActivityActive,
  normalizeDiscordId,
  toActivityIso,
  toPlayerListDTO
};
