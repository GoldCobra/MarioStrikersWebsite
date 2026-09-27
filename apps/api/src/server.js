const compression = require("compression");
const express = require("express");
const cors = require("cors");
const { config } = require("./config");
const { assertGameAndMode, parseLimit, parseOffset } = require("./lib/leaderboard-params");
const {
  COMPETITIVE_SEASON_KEY,
  PLAYERS_LIST_KEY,
  MSBL_CLUBS_KEY,
  PUBLIC_LEADERBOARD_LIMIT,
  isPublicLeaderboardVariant,
  leaderboardCacheKey
} = require("./lib/public-data-keys");

function createLiveProviders() {
  return {
    source: "mssql",
    healthCheck: require("./db").healthCheck,
    getLeaderboardRows: require("./services/leaderboards-service").getLeaderboardRows,
    getPlayerProfile: require("./services/players-service").getPlayerProfile,
    getPlayerProfileByDiscordId: require("./services/players-service").getPlayerProfileByDiscordId,
    getMsblClubProfile: require("./services/clubs-service").getMsblClubProfile,
    defaultClubLogoCache: require("./services/club-logo-cache").defaultClubLogoCache,
    communityEventsCache: require("./services/events-service").communityEventsCache,
    publicDataCache: require("./services/public-data-cache").publicDataCache,
    auth: require("./services/auth-service")
  };
}

const PUBLIC_DATA_CACHE_CONTROL = "public, max-age=30, stale-while-revalidate=60";

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

function createApp(options) {
  const opts = options || {};
  const providers = opts.providers || createLiveProviders();
  const fixtureMode = providers.source === "fixtures";
  if (fixtureMode && process.env.NODE_ENV === "production") {
    throw new Error("Fixture development mode cannot run in production.");
  }
  const { healthCheck, getLeaderboardRows, getPlayerProfile, getPlayerProfileByDiscordId,
    getMsblClubProfile, defaultClubLogoCache, communityEventsCache, publicDataCache } = providers;
  const { appendQuery, buildDiscordAuthorizeUrl, completeDiscordLogin, createClearSessionCookie,
    createSessionCookie, readSessionFromRequest, toAuthMeResponse, verifyOAuthState } = providers.auth;
  const app = express();
  if (fixtureMode) {
    app.use(function (_req, res, next) {
      res.set("X-Data-Source", "fixtures");
      next();
    });
  }
  app.use(compression());
  app.use(cors(buildCorsOptions()));
  app.use(express.json({ limit: "1mb" }));

  function sendApiError(res, error) {
    const message = error && error.message ? error.message : "Request failed.";
    const isValidationError = /^Invalid /.test(message);
    if (!isValidationError) {
      console.error("[api] Error:", error);
    }
    res.status(isValidationError ? 400 : 500).json({ error: message });
  }

  function sendNoStoreJson(res, payload, statusCode) {
    res.set("Cache-Control", "no-store");
    res.status(statusCode || 200).json(payload);
  }

  function getAuthSession(req) {
    return readSessionFromRequest(req);
  }

  function sendPublicDataJson(res, cacheResult, payload) {
    res.set("X-Data-Cache", cacheResult.cacheStatus);
    res.set("X-Data-Generated-At", cacheResult.generatedAt);
    res.set("Cache-Control", PUBLIC_DATA_CACHE_CONTROL);
    res.json(payload);
  }

  function sliceLeaderboardPayload(payload, limit) {
    const rows = Array.isArray(payload && payload.rows)
      ? payload.rows.slice(0, limit)
      : [];
    return {
      game: payload && payload.game,
      mode: payload && payload.mode,
      count: rows.length,
      rows: rows
    };
  }

  app.get("/api/auth/discord/start", function (req, res) {
    try {
      const redirectUrl = buildDiscordAuthorizeUrl(req.query && req.query.returnTo);
      res.redirect(302, redirectUrl);
    } catch (error) {
      sendApiError(res, error);
    }
  });

  app.get("/api/auth/discord/callback", async function (req, res) {
    let state;
    try {
      state = verifyOAuthState(req.query && req.query.state);
    } catch (_error) {
      res.status(400).send("Invalid OAuth state.");
      return;
    }

    const code = String(req.query && req.query.code || "").trim();
    if (!code) {
      res.redirect(302, appendQuery(state.returnTo, { auth: "failed" }));
      return;
    }

    try {
      const login = await completeDiscordLogin(code);
      res.set("Set-Cookie", createSessionCookie(login.user));
      res.redirect(302, appendQuery(state.returnTo, { auth: "success" }));
    } catch (error) {
      const authStatus = error && error.statusCode === 403 ? "not_member" : "failed";
      if (authStatus !== "not_member") {
        console.error("[auth] Discord login failed:", error);
      }
      res.redirect(302, appendQuery(state.returnTo, { auth: authStatus }));
    }
  });

  app.get("/api/auth/me", function (req, res) {
    sendNoStoreJson(res, toAuthMeResponse(getAuthSession(req)));
  });

  app.post("/api/auth/logout", function (_req, res) {
    res.set("Set-Cookie", createClearSessionCookie());
    sendNoStoreJson(res, { ok: true });
  });

  app.get("/api/profile/me", async function (req, res) {
    res.set("Cache-Control", "no-store");
    let session;
    try {
      session = getAuthSession(req);
      if (!session) {
        sendNoStoreJson(res, {
          error: "Authentication required.",
          code: "AUTH_REQUIRED"
        }, 401);
        return;
      }

      const profile = await getPlayerProfileByDiscordId(session.discord_user_id);
      if (!profile) {
        sendNoStoreJson(res, {
          error: "No linked player profile.",
          code: "PLAYER_PROFILE_NOT_LINKED",
          account: toAuthMeResponse(session).user
        }, 404);
        return;
      }

      sendNoStoreJson(res, {
        account: toAuthMeResponse(session).user,
        profile: profile
      });
    } catch (error) {
      if (error && error.code === "PLAYER_PROFILE_CONFLICT") {
        sendNoStoreJson(res, {
          error: "Multiple player profiles match this Discord account.",
          code: "PLAYER_PROFILE_CONFLICT",
          account: toAuthMeResponse(session).user
        }, 409);
        return;
      }
      sendApiError(res, error);
    }
  });

  app.get("/api/leaderboards/:game/:mode", async function (req, res) {
    try {
      const params = assertGameAndMode(req.params.game, req.params.mode);
      const limit = parseLimit(req.query.limit, config.leaderboardDefaultLimit);
      const offset = parseOffset(req.query.offset);
      if (offset === 0 && limit <= PUBLIC_LEADERBOARD_LIMIT && isPublicLeaderboardVariant(params.game, params.mode)) {
        const cached = await publicDataCache.get(leaderboardCacheKey(params.game, params.mode));
        sendPublicDataJson(res, cached, sliceLeaderboardPayload(cached.payload, limit));
        return;
      }

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
      if (isPublicLeaderboardVariant(params.game, params.mode)) {
        const cappedLimit = Math.min(limit, PUBLIC_LEADERBOARD_LIMIT);
        const cached = await publicDataCache.get(leaderboardCacheKey(params.game, params.mode));
        sendPublicDataJson(res, cached, sliceLeaderboardPayload(cached.payload, cappedLimit));
        return;
      }

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

  app.get(["/api/clubs", "/api/clubs/msbl"], async function (_req, res) {
    try {
      const cached = await publicDataCache.get(MSBL_CLUBS_KEY);
      sendPublicDataJson(res, cached, cached.payload);
    } catch (error) {
      sendApiError(res, error);
    }
  });

  app.get("/api/events/community", async function (_req, res) {
    try {
      const payload = await communityEventsCache.get();
      res.set("Cache-Control", PUBLIC_DATA_CACHE_CONTROL);
      res.json(payload);
    } catch (error) {
      sendApiError(res, error);
    }
  });

  app.get("/api/clubs/msbl/:clubId/logo", async function (req, res) {
    try {
      const logoFile = await defaultClubLogoCache.getLogoFile(req.params.clubId);
      if (!logoFile) {
        res.status(404).json({ error: "Club logo not found." });
        return;
      }

      res.set("Content-Type", logoFile.contentType);
      res.set("Cache-Control", "public, max-age=2592000, immutable");
      res.set("ETag", '"' + logoFile.hash + '"');
      res.sendFile(logoFile.absolutePath);
    } catch (error) {
      sendApiError(res, error);
    }
  });

  app.get("/api/clubs/msbl/:clubId/profile", async function (req, res) {
    try {
      const profile = await getMsblClubProfile(req.params.clubId);
      res.set("Cache-Control", "no-store");
      res.json(profile);
    } catch (error) {
      if (error && /not found/i.test(String(error.message || ""))) {
        res.status(404).json({ error: "Club not found." });
        return;
      }
      sendApiError(res, error);
    }
  });

  app.get("/api/players", async function (_req, res) {
    try {
      const cached = await publicDataCache.get(PLAYERS_LIST_KEY);
      sendPublicDataJson(res, cached, cached.payload);
    } catch (error) {
      sendApiError(res, error);
    }
  });

  app.get("/api/competitive-season/current", async function (_req, res) {
    res.set("Cache-Control", "no-store");
    try {
      const cached = await publicDataCache.get(COMPETITIVE_SEASON_KEY);
      res.set("X-Data-Cache", cached.cacheStatus);
      res.set("X-Data-Generated-At", cached.generatedAt);
      // Fixtures may pin the clock (MSC_FIXTURE_NOW); live providers always use the real time.
      const serverNow = typeof providers.now === "function" ? providers.now() : Date.now();
      res.json({ ...cached.payload, serverNowUtc: new Date(serverNow).toISOString() });
    } catch (error) {
      sendApiError(res, error);
    }
  });

  app.get("/api/players/:playerId/profile", async function (req, res) {
    try {
      const profile = await getPlayerProfile(req.params.playerId);
      res.set("Cache-Control", "no-store");
      res.json(profile);
    } catch (error) {
      if (error && /not found/i.test(String(error.message || ""))) {
        res.status(404).json({ error: "Player not found." });
        return;
      }
      sendApiError(res, error);
    }
  });

  let _wiimmfiCache = null;
  let _wiimmfiCacheAt = 0;

  function parseWiimmfiText(text) {
    const lines = text.split("\n");
    const players = [];
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed || trimmed.startsWith("!")) continue;
      const parts = trimmed.split("|");
      // leading | makes parts[0] empty; fields start at index 1
      // order: id4, pid, fc, host, gid, ls_stat, ol_stat, status, suspend, n, name1, name2
      const id4 = parts[1] || "";
      const fc = parts[3] || "";
      const name1 = parts[11] ? parts[11].trim() : "";
      if (name1) {
        players.push({ region: id4.trim(), friendCode: fc.trim(), name: name1 });
      }
    }
    return players;
  }

  async function fetchWiimmfiPlayers() {
    if (_wiimmfiCache !== null && Date.now() - _wiimmfiCacheAt < 60000) {
      return _wiimmfiCache;
    }
    const res = await fetch(config.flareSolverrUrl + "/v1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cmd: "request.get",
        url: "https://wiimmfi.de/stats/game/mschargedwii/text",
        maxTimeout: 60000
      })
    });
    if (!res.ok) throw new Error("FlareSolverr HTTP " + res.status);
    const data = await res.json();
    if (data.status !== "ok") throw new Error("FlareSolverr: " + (data.message || data.status));
    const players = parseWiimmfiText(data.solution.response);
    _wiimmfiCache = players;
    _wiimmfiCacheAt = Date.now();
    return players;
  }

  app.get("/api/wiimmfi/msc-charged", async function (_req, res) {
    try {
      const players = await (providers.fetchWiimmfiPlayers || fetchWiimmfiPlayers)();
      res.set("Cache-Control", PUBLIC_DATA_CACHE_CONTROL);
      res.json({ count: players.length, players: players });
    } catch (error) {
      sendApiError(res, error);
    }
  });

  app.get("/api/health", async function (_req, res) {
    try {
      await healthCheck();
      res.json({
        status: "ok",
        source: providers.source
      });
    } catch (error) {
      res.status(500).json({
        status: "error",
        source: providers.source,
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
