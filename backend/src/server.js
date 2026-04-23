const express = require("express");
const cors = require("cors");
const { config } = require("./config");
const { healthCheck } = require("./db");
const { getLeaderboardRows, assertGameAndMode, parseLimit } = require("./services/leaderboards-service");
const { getMsblClubs } = require("./services/clubs-service");
const { getPlayersList, getPlayerProfile } = require("./services/players-service");

function buildCorsOptions() {
  if (config.corsOrigin === "*") {
    return { origin: "*" };
  }
  return {
    origin: config.corsOrigin
      .split(",")
      .map(function (item) {
        return item.trim();
      })
      .filter(Boolean)
  };
}

function createApp() {
  const app = express();
  app.use(cors(buildCorsOptions()));
  app.use(express.json({ limit: "1mb" }));

  function sendApiError(res, error) {
    const message = error && error.message ? error.message : "Request failed.";
    const isValidationError = /^Invalid /.test(message);
    res.status(isValidationError ? 400 : 500).json({ error: message });
  }

  app.get("/api/leaderboards/:game/:mode", async function (req, res) {
    try {
      const params = assertGameAndMode(req.params.game, req.params.mode);
      const rows = await getLeaderboardRows({
        gameCode: params.game,
        modeCode: params.mode,
        limit: req.query.limit,
        offset: req.query.offset
      });
      res.json({
        game: params.game,
        mode: params.mode,
        count: rows.length,
        rows: rows
      });
    } catch (error) {
      sendApiError(res, error);
    }
  });

  app.get("/api/leaderboards/:game/:mode/top", async function (req, res) {
    try {
      const params = assertGameAndMode(req.params.game, req.params.mode);
      const limit = parseLimit(req.query.limit, 25);
      const rows = await getLeaderboardRows({
        gameCode: params.game,
        modeCode: params.mode,
        limit: Math.min(limit, 100),
        offset: 0
      });
      res.json({
        game: params.game,
        mode: params.mode,
        count: rows.length,
        rows: rows
      });
    } catch (error) {
      sendApiError(res, error);
    }
  });

  app.get("/api/clubs/msbl", async function (_req, res) {
    try {
      const rows = await getMsblClubs();
      res.json({
        game: "msbl",
        count: rows.length,
        rows: rows
      });
    } catch (error) {
      sendApiError(res, error);
    }
  });

  app.get("/api/players", async function (_req, res) {
    try {
      const rows = await getPlayersList();
      res.json({
        count: rows.length,
        rows: rows
      });
    } catch (error) {
      sendApiError(res, error);
    }
  });

  app.get("/api/players/:playerId/profile", async function (req, res) {
    try {
      const profile = await getPlayerProfile(req.params.playerId);
      res.json(profile);
    } catch (error) {
      if (error && /not found/i.test(String(error.message || ""))) {
        res.status(404).json({ error: "Player not found." });
        return;
      }
      sendApiError(res, error);
    }
  });

  app.get("/api/health", async function (_req, res) {
    try {
      await healthCheck();
      res.json({
        status: "ok",
        source: "mssql"
      });
    } catch (error) {
      res.status(500).json({
        status: "error",
        source: "mssql",
        error: error.message
      });
    }
  });

  app.use(function (_req, res) {
    res.status(404).json({ error: "Not found." });
  });

  return app;
}

module.exports = { createApp };
