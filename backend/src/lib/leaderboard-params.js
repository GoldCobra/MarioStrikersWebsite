const { config } = require("../config");

const GAME_TYPE_BY_CODE = { msc: 1, sms: 2, msbl: 3 };
const COMPETITIVE_MODE_BY_CODE = { elo1v1: "1v1", elo2v2: "2v2" };
const LEGACY_MODE_TO_FLAGS = { whr: { doubles: 0, isWhr: 2 } };

function parseLimit(value, fallback) {
  const parsed = Number(value);
  return !Number.isFinite(parsed) || parsed <= 0
    ? fallback : Math.min(Math.floor(parsed), config.leaderboardMaxLimit);
}

function parseOffset(value) {
  const parsed = Number(value);
  return !Number.isFinite(parsed) || parsed < 0 ? 0 : Math.floor(parsed);
}

function assertGameAndMode(gameCode, modeCode) {
  const game = String(gameCode || "").toLowerCase().trim();
  const mode = String(modeCode || "").toLowerCase().trim();
  if (!GAME_TYPE_BY_CODE[game]) throw new Error("Invalid game code.");
  if (!COMPETITIVE_MODE_BY_CODE[mode] && !LEGACY_MODE_TO_FLAGS[mode]) {
    throw new Error("Invalid leaderboard mode.");
  }
  return { game, mode };
}

module.exports = { GAME_TYPE_BY_CODE, COMPETITIVE_MODE_BY_CODE, LEGACY_MODE_TO_FLAGS, parseLimit, parseOffset, assertGameAndMode };
