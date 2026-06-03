const { config } = require("../config");
const { withPool, mssql } = require("../db");
const { normalizeCompetitiveRank } = require("./competitive-ranks");

const GAME_TYPE_BY_CODE = {
  msc: 1,
  sms: 2,
  msbl: 3
};

const COMPETITIVE_MODE_BY_CODE = {
  elo1v1: "1v1",
  elo2v2: "2v2"
};

const LEGACY_MODE_TO_FLAGS = {
  whr: { doubles: 0, isWhr: 2 }
};

const ACTIVITY_FILTER_DAYS_BY_GAME = {
  msbl: 90,
  sms: null,
  msc: null
};

function parseLimit(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(parsed), config.leaderboardMaxLimit);
}

function parseOffset(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function assertGameAndMode(gameCode, modeCode) {
  const game = String(gameCode || "").toLowerCase().trim();
  const mode = String(modeCode || "").toLowerCase().trim();

  if (!GAME_TYPE_BY_CODE[game]) {
    throw new Error("Invalid game code.");
  }
  if (!COMPETITIVE_MODE_BY_CODE[mode] && !LEGACY_MODE_TO_FLAGS[mode]) {
    throw new Error("Invalid leaderboard mode.");
  }

  return { game: game, mode: mode };
}

function toSafeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.floor(parsed));
}

function toRating(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.round(parsed);
}

function toIsoString(value) {
  if (!value) {
    return new Date().toISOString();
  }

  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? date.toISOString() : new Date().toISOString();
}

function parseRatingLine(lineValue) {
  const text = String(lineValue || "");
  const rankEmoji = text.match(/<:([^:>]+):\d+>/i);
  const rawRankCode = rankEmoji ? String(rankEmoji[1] || "").trim().toLowerCase() : "";
  const canonicalRank = normalizeCompetitiveRank(rawRankCode);

  const parts = text.split("`");
  if (parts.length < 2) {
    return null;
  }

  const payload = String(parts[1] || "").trim();
  const match = payload.match(/^(.*?)(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) {
    return null;
  }

  const displayName = String(match[1] || "").trim();
  const rating = Number(match[2]);
  if (!displayName || !Number.isFinite(rating)) {
    return null;
  }

  return {
    displayName: displayName,
    rating: rating,
    competitiveRank: canonicalRank ? canonicalRank.name : (rawRankCode || "")
  };
}

async function fetchRawRatings(pool, gameType, flags, playedGameWithinDate) {
  const request = pool.request();
  request.input("gametype", mssql.Int, gameType);
  request.input("doubles", mssql.Int, flags.doubles);
  request.input("isWhr", mssql.Int, flags.isWhr);
  let query = "exec GetRatingsForDiscord @gametype, @doubles, @isWhr";
  if (playedGameWithinDate) {
    request.input("playedGameWithinDate", mssql.DateTime, playedGameWithinDate);
    query += ", @playedGameWithinDate";
  }
  const result = await request.query(query);
  return Array.isArray(result && result.recordset) ? result.recordset : [];
}

async function fetchCompetitiveLeaderboardRows(pool, gameType, mode, limit, offset) {
  const request = pool.request();
  request.input("gametype", mssql.Int, gameType);
  request.input("mode", mssql.VarChar, mode);
  request.input("offset", mssql.Int, offset);
  request.input("limit", mssql.Int, limit);

  const query = [
    "SELECT",
    "  lb.Position AS rank,",
    "  lb.DiscordId AS discord_user_id,",
    "  lb.PlayerName AS display_name,",
    "  lb.TotalMatches AS total_matches,",
    "  lb.MatchWins AS total_wins,",
    "  lb.MatchLosses AS total_losses,",
    "  lb.Elo AS rating,",
    "  lb.RankName AS competitive_rank,",
    "  lb.UpdatedAtUtc AS updated_at",
    "FROM CompetitiveLeaderboard lb",
    "INNER JOIN CompetitiveSeason season ON season.Id = lb.SeasonId",
    "WHERE season.IsActive = 1",
    "  AND season.LifecycleStatus = 'active'",
    "  AND lb.GameType = @gametype",
    "  AND lb.Mode = @mode",
    "ORDER BY lb.Position ASC, lb.Elo DESC, lb.PlayerName ASC",
    "OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY"
  ].join(" ");

  const result = await request.query(query);
  const rows = Array.isArray(result && result.recordset) ? result.recordset : [];

  return rows.map(function (row, index) {
    const rank = Number(row.rank);
    const wins = toSafeInteger(row.total_wins);
    const losses = toSafeInteger(row.total_losses);
    const totalMatches = toSafeInteger(row.total_matches);
    return {
      rank: Number.isFinite(rank) && rank > 0 ? Math.floor(rank) : offset + index + 1,
      discord_user_id: row.discord_user_id ? String(row.discord_user_id).trim() : null,
      display_name: String(row.display_name || "").trim(),
      total_matches: totalMatches || wins + losses,
      total_wins: wins,
      total_losses: losses,
      total_draws: 0,
      total_game_diff: 0,
      total_goals_for: 0,
      total_goals_against: 0,
      total_goal_diff: 0,
      rating: toRating(row.rating),
      competitive_rank: String(row.competitive_rank || "").trim(),
      updated_at: toIsoString(row.updated_at)
    };
  }).filter(function (row) {
    return !!row.display_name;
  });
}

async function fetchWinsLosses(pool, gameType, names) {
  if (!Array.isArray(names) || names.length === 0) {
    return new Map();
  }

  const request = pool.request();
  request.input("gametype", mssql.Int, gameType);

  const nameParams = names.map(function (name, index) {
    const paramName = "name_" + index;
    request.input(paramName, mssql.NVarChar, name);
    return "@" + paramName;
  });

  const query = [
    "SELECT p.Name AS name, ps.Wins AS total_wins, ps.Losses AS total_losses, ps.MatchDraws AS total_draws",
    "FROM PlayerStats ps",
    "INNER JOIN Player p ON p.ID = ps.Player",
    "WHERE ps.GameType = @gametype",
    "AND p.Name IN (" + nameParams.join(",") + ")"
  ].join(" ");

  const result = await request.query(query);
  const map = new Map();
  (result.recordset || []).forEach(function (row) {
    const key = String(row.name || "").trim().toLowerCase();
    if (!key) {
      return;
    }

    const wins = Number(row.total_wins || 0);
    const losses = Number(row.total_losses || 0);
    const draws = Number(row.total_draws || 0);

    map.set(key, {
      totalWins: Number.isFinite(wins) ? Math.max(0, Math.floor(wins)) : 0,
      totalLosses: Number.isFinite(losses) ? Math.max(0, Math.floor(losses)) : 0,
      totalDraws: Number.isFinite(draws) ? Math.max(0, Math.floor(draws)) : 0
    });
  });

  return map;
}

async function fetchDiscordIds(pool, names) {
  if (!Array.isArray(names) || names.length === 0) {
    return new Map();
  }

  const request = pool.request();
  const nameParams = names.map(function (name, index) {
    const paramName = "id_name_" + index;
    request.input(paramName, mssql.NVarChar, name);
    return "@" + paramName;
  });

  const query = [
    "SELECT p.Name AS name, p.DiscordID AS discord_user_id",
    "FROM Player p",
    "WHERE p.Name IN (" + nameParams.join(",") + ")",
    "AND p.DiscordID IS NOT NULL",
    "AND p.DiscordID <> ''"
  ].join(" ");

  const result = await request.query(query);
  const map = new Map();
  (result.recordset || []).forEach(function (row) {
    const key = String(row.name || "").trim().toLowerCase();
    const discordId = String(row.discord_user_id || "").trim();
    if (!key || !discordId) {
      return;
    }
    map.set(key, discordId);
  });

  return map;
}

async function getLeaderboardRows(options) {
  const normalized = assertGameAndMode(options.gameCode, options.modeCode);
  const limit = parseLimit(options.limit, config.leaderboardDefaultLimit);
  const offset = parseOffset(options.offset);
  const gameType = GAME_TYPE_BY_CODE[normalized.game];

  return withPool(async function (pool) {
    const competitiveMode = COMPETITIVE_MODE_BY_CODE[normalized.mode];
    if (competitiveMode) {
      return fetchCompetitiveLeaderboardRows(pool, gameType, competitiveMode, limit, offset);
    }

    const flags = LEGACY_MODE_TO_FLAGS[normalized.mode];
    const activityDays = ACTIVITY_FILTER_DAYS_BY_GAME[normalized.game];
    const playedGameWithinDate = activityDays
      ? (() => { const d = new Date(); d.setDate(d.getDate() - activityDays); return d; })()
      : null;
    const rawRows = await fetchRawRatings(pool, gameType, flags, playedGameWithinDate);

    const parsed = rawRows
      .map(function (row) {
        return parseRatingLine(row && row.line);
      })
      .filter(Boolean);

    const names = parsed.map(function (row) {
      return row.displayName;
    });

    const [winsLossesMap, discordIdMap] = await Promise.all([
      fetchWinsLosses(pool, gameType, names),
      fetchDiscordIds(pool, names)
    ]);

    const merged = parsed.map(function (row) {
      const key = row.displayName.toLowerCase();
      const wl = winsLossesMap.get(key) || { totalWins: 0, totalLosses: 0, totalDraws: 0 };
      const totalMatches = wl.totalWins + wl.totalLosses + wl.totalDraws;

      return {
        discord_user_id: discordIdMap.get(key) || null,
        display_name: row.displayName,
        total_matches: totalMatches,
        total_wins: wl.totalWins,
        total_losses: wl.totalLosses,
        total_draws: wl.totalDraws,
        total_game_diff: 0,
        total_goals_for: 0,
        total_goals_against: 0,
        total_goal_diff: 0,
        rating: row.rating,
        competitive_rank: row.competitiveRank,
        updated_at: new Date().toISOString()
      };
    });

    merged.sort(function (a, b) {
      const byRating = Number(b.rating || 0) - Number(a.rating || 0);
      if (byRating !== 0) {
        return byRating;
      }
      return String(a.display_name || "").localeCompare(String(b.display_name || ""));
    });

    return merged.slice(offset, offset + limit).map(function (row, index) {
      return {
        rank: offset + index + 1,
        discord_user_id: row.discord_user_id,
        display_name: row.display_name,
        total_matches: row.total_matches,
        total_wins: row.total_wins,
        total_losses: row.total_losses,
        total_draws: row.total_draws,
        total_game_diff: row.total_game_diff,
        total_goals_for: row.total_goals_for,
        total_goals_against: row.total_goals_against,
        total_goal_diff: row.total_goal_diff,
        rating: row.rating,
        competitive_rank: row.competitive_rank,
        updated_at: row.updated_at
      };
    });
  });
}

module.exports = {
  getLeaderboardRows,
  parseLimit,
  parseOffset,
  assertGameAndMode
};
