const { config } = require("../config");
const { withPool, mssql } = require("../db");
const { normalizeCompetitiveRank } = require("./competitive-ranks");

const GAME_TYPE_BY_CODE = {
  msc: 1,
  sms: 2,
  msbl: 3
};

const MODE_TO_FLAGS = {
  elo1v1: { doubles: 0, isWhr: 0 },
  elo2v2: { doubles: 1, isWhr: 0 },
  whr: { doubles: 0, isWhr: 2 }
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
  if (!MODE_TO_FLAGS[mode]) {
    throw new Error("Invalid leaderboard mode.");
  }

  return { game: game, mode: mode };
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

async function fetchRawRatings(pool, gameType, flags) {
  const request = pool.request();
  request.input("gametype", mssql.Int, gameType);
  request.input("doubles", mssql.Int, flags.doubles);
  request.input("isWhr", mssql.Int, flags.isWhr);
  const result = await request.query("exec GetRatingsForDiscord @gametype, @doubles, @isWhr");
  return Array.isArray(result && result.recordset) ? result.recordset : [];
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
  const flags = MODE_TO_FLAGS[normalized.mode];

  return withPool(async function (pool) {
    const rawRows = await fetchRawRatings(pool, gameType, flags);

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
