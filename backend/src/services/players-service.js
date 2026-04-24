const { withPool, mssql } = require("../db");

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
      "  p.IdStartGG AS id_start_gg",
      "FROM Player p",
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
    id_start_gg: normalizeText(row.id_start_gg)
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

async function getPlayerProfileSummary(pool, playerName) {
  const request = pool.request();
  request.input("searchTerm", mssql.NVarChar, playerName);
  const result = await request.execute("GetProfile");
  const rows = Array.isArray(result && result.recordset) ? result.recordset : [];
  return rows[0] || null;
}

async function getPlayerAccolades(pool, playerName) {
  const request = pool.request();
  request.input("SearchTerm", mssql.NVarChar, playerName);
  const result = await request.execute("getTournamentAccoladeListing");
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
        "  p.Country AS country",
        "FROM Player p",
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
        const name = normalizeText(row && row.name);
        if (!name) {
          return null;
        }

        return {
          player_id: Number(row && row.player_id) || null,
          name: name,
          country: normalizeCountry(row && row.country)
        };
      })
      .filter(Boolean);
  });
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

    const [friendCodes, profile, accolades] = await Promise.all([
      getPlayerFriendCodes(pool, playerId),
      getPlayerProfileSummary(pool, player.name),
      getPlayerAccolades(pool, player.name)
    ]);

    const profileData = profile || {};

    return {
      player: {
        id: player.player_id,
        name: player.name,
        country: player.country,
        results_url: normalizeResultsUrl(profileData.ResultsStartGG, player.id_start_gg)
      },
      friend_codes: friendCodes,
      accolades: accolades,
      ratings: buildRatings(profileData),
      highest_rank_banner_url: normalizeText(profileData.RankImage)
    };
  });
}

module.exports = {
  getPlayersList,
  getPlayerProfile
};
