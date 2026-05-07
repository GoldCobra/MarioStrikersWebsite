const path = require("path");
const fs = require("fs");
const compression = require("compression");
const express = require("express");
const cors = require("cors");
const { config } = require("./config");
const { healthCheck } = require("./db");
const { getLeaderboardRows, assertGameAndMode, parseLimit } = require("./services/leaderboards-service");
const { getMsblClubs } = require("./services/clubs-service");
const { getPlayersList, getPlayerProfile } = require("./services/players-service");

const STATIC_ROOT = path.join(__dirname, "../../");
const STATIC_PAGES_ROOT = path.join(STATIC_ROOT, "pages");
const LEGACY_PAGE_ROUTE = /^\/pages\/([a-z0-9-]+)\.html$/i;
const CLEAN_PAGE_ROUTE = /^\/([a-z0-9-]+)$/i;
const CLEAN_PAGE_TRAILING_SLASH_ROUTE = /^\/([a-z0-9-]+)\/$/i;
const PAGE_ROUTE_ALIASES = {
  "msl-league-site": "msl-schedule"
};
const LEGACY_SUBMENU_ROUTE_MAP = {
  games: {
    msbl: "msbl",
    msc: "msc",
    sms: "sms"
  },
  competitive: {
    rules: "competitive-rules",
    leaderboards: "competitive-leaderboards",
    "tier-lists": "competitive-tier-lists",
    msl: "msl",
    tournaments: "competitive-tournaments"
  }
};

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

function getOriginalQuery(req) {
  const queryIndex = req.originalUrl.indexOf("?");
  return queryIndex === -1 ? "" : req.originalUrl.slice(queryIndex);
}

function redirectToCleanPage(req, res, pageSlug) {
  res.redirect(301, `/${pageSlug}${getOriginalQuery(req)}`);
}

function buildFilteredQuery(req) {
  const params = new URLSearchParams();
  const query = req.query || {};
  Object.keys(query).forEach(function (key) {
    if (key === "submenu" || key === "tabs") {
      return;
    }

    const rawValue = query[key];
    if (Array.isArray(rawValue)) {
      rawValue.forEach(function (entry) {
        if (entry !== undefined && entry !== null) {
          params.append(key, String(entry));
        }
      });
      return;
    }

    if (rawValue !== undefined && rawValue !== null) {
      params.append(key, String(rawValue));
    }
  });

  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

function toCanonicalPageSlug(pageSlug) {
  const normalizedSlug = String(pageSlug || "").toLowerCase();
  return PAGE_ROUTE_ALIASES[normalizedSlug] || normalizedSlug;
}

function pageFileExists(pageSlug) {
  return fs.existsSync(path.join(STATIC_PAGES_ROOT, `${pageSlug}.html`));
}

function resolveExistingPageSlug(pageSlug) {
  const canonicalPageSlug = toCanonicalPageSlug(pageSlug);
  return pageFileExists(canonicalPageSlug) ? canonicalPageSlug : "";
}

function redirectLegacyQueryRoute(req, res, pageSlug) {
  const normalizedPageSlug = String(pageSlug || "").toLowerCase();
  const submenuRaw = req.query && req.query.submenu;
  const tabsRaw = req.query && req.query.tabs;
  const submenu = Array.isArray(submenuRaw) ? String(submenuRaw[0] || "").trim().toLowerCase() : String(submenuRaw || "").trim().toLowerCase();
  const tabs = Array.isArray(tabsRaw) ? String(tabsRaw[0] || "").trim().toLowerCase() : String(tabsRaw || "").trim().toLowerCase();
  const routeMap = LEGACY_SUBMENU_ROUTE_MAP[normalizedPageSlug];

  let targetPageSlug = "";
  if (submenu && routeMap && routeMap[submenu]) {
    targetPageSlug = routeMap[submenu];
  } else if (submenu || tabs === "none") {
    targetPageSlug = normalizedPageSlug;
  }

  if (!targetPageSlug) {
    return false;
  }

  const resolvedTargetPageSlug = resolveExistingPageSlug(targetPageSlug);
  if (!resolvedTargetPageSlug) {
    return false;
  }

  res.redirect(301, `/${resolvedTargetPageSlug}${buildFilteredQuery(req)}`);
  return true;
}

function redirectToResolvedPage(req, res, pageSlug) {
  const resolvedPageSlug = resolveExistingPageSlug(pageSlug);
  if (!resolvedPageSlug) {
    return false;
  }

  redirectToCleanPage(req, res, resolvedPageSlug);
  return true;
}

function sendStaticPage(res, absolutePath, next) {
  res.sendFile(absolutePath, function (error) {
    if (!error) {
      return;
    }

    if (typeof next === "function") {
      next();
      return;
    }

    if (!res.headersSent) {
      res.status(error.statusCode || 404).end();
    }
  });
}

function createApp() {
  const app = express();
  app.use(compression());
  app.use(cors(buildCorsOptions()));
  app.use(express.json({ limit: "1mb" }));

  if (process.env.SERVE_STATIC === "true") {
    app.use(function (req, res, next) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        next();
        return;
      }

      if (req.path === "/index.html") {
        res.redirect(301, `/${getOriginalQuery(req)}`);
        return;
      }

      const legacyPageMatch = req.path.match(LEGACY_PAGE_ROUTE);
      if (legacyPageMatch && redirectToResolvedPage(req, res, legacyPageMatch[1])) {
        return;
      }

      const rootHtmlPageMatch = req.path.match(/^\/([a-z0-9-]+)\.html$/i);
      if (rootHtmlPageMatch && redirectToResolvedPage(req, res, rootHtmlPageMatch[1])) {
        return;
      }

      const legacyExtensionlessPageMatch = req.path.match(/^\/pages\/([a-z0-9-]+)\/?$/i);
      if (legacyExtensionlessPageMatch && redirectToResolvedPage(req, res, legacyExtensionlessPageMatch[1])) {
        return;
      }

      const cleanPageMatch = req.path.match(CLEAN_PAGE_ROUTE);
      if (cleanPageMatch) {
        const pageSlug = cleanPageMatch[1].toLowerCase();
        if (redirectLegacyQueryRoute(req, res, pageSlug)) {
          return;
        }
        const canonicalPageSlug = toCanonicalPageSlug(pageSlug);
        if (canonicalPageSlug !== pageSlug && pageFileExists(canonicalPageSlug)) {
          redirectToCleanPage(req, res, canonicalPageSlug);
          return;
        }
        if (pageFileExists(canonicalPageSlug)) {
          sendStaticPage(res, path.join(STATIC_PAGES_ROOT, `${canonicalPageSlug}.html`), next);
          return;
        }
      }

      const trailingSlashMatch = req.path.match(CLEAN_PAGE_TRAILING_SLASH_ROUTE);
      if (trailingSlashMatch && redirectToResolvedPage(req, res, trailingSlashMatch[1])) {
        return;
      }

      next();
    });

    app.use(express.static(STATIC_ROOT));
  }

  function sendApiError(res, error) {
    const message = error && error.message ? error.message : "Request failed.";
    const isValidationError = /^Invalid /.test(message);
    if (!isValidationError) {
      console.error("[api] Error:", error);
    }
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

  app.get(["/api/clubs", "/api/clubs/msbl"], async function (_req, res) {
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
      const players = await fetchWiimmfiPlayers();
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

  if (process.env.SERVE_STATIC === "true") {
    app.get("/", function (_req, res) {
      sendStaticPage(res, path.join(STATIC_ROOT, "index.html"));
    });

    app.get(CLEAN_PAGE_ROUTE, function (req, res, next) {
      const pageSlug = String(req.params[0] || "").toLowerCase();
      sendStaticPage(res, path.join(STATIC_PAGES_ROOT, `${pageSlug}.html`), next);
    });
  }

  app.use(function (_req, res) {
    res.status(404).json({ error: "Not found." });
  });

  return app;
}

module.exports = { createApp };
