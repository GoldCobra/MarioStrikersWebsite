const fs = require("fs");
const path = require("path");
const { config } = require("../config");
const { getLeaderboardRows } = require("./leaderboards-service");
const { getMsblClubs } = require("./clubs-service");
const { getPlayersList } = require("./players-service");
const { getCompetitiveSeasonStatus } = require("./competitive-season-service");

const SNAPSHOT_VERSION = 1;
const PLAYERS_LIST_KEY = "players:list";
const MSBL_CLUBS_KEY = "clubs:msbl";
const COMPETITIVE_SEASON_KEY = "competitive-season:current";
const PUBLIC_LEADERBOARD_LIMIT = 100;
const PUBLIC_LEADERBOARD_VARIANTS = Object.freeze([
  { game: "msbl", mode: "elo1v1" },
  { game: "msbl", mode: "elo2v2" },
  { game: "msbl", mode: "whr" },
  { game: "msc", mode: "elo1v1" },
  { game: "msc", mode: "whr" },
  { game: "sms", mode: "elo1v1" },
  { game: "sms", mode: "whr" }
]);

function leaderboardCacheKey(game, mode) {
  return "leaderboard:" + String(game || "").toLowerCase() + ":" + String(mode || "").toLowerCase();
}

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function normalizeGeneratedAt(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : 0;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
  }
  return 0;
}

function createEntry(payload, generatedAtMs) {
  return {
    payload: payload,
    generatedAtMs: generatedAtMs || Date.now()
  };
}

function runLimited(items, limit, worker) {
  const queue = Array.isArray(items) ? items.slice() : [];
  const workerCount = Math.max(1, Math.min(toPositiveInt(limit, 1), queue.length || 1));

  async function runWorker() {
    while (queue.length > 0) {
      const item = queue.shift();
      await worker(item);
    }
  }

  return Promise.all(
    Array.from({ length: workerCount }, function () {
      return runWorker();
    })
  );
}

class PublicDataCache {
  constructor(options) {
    const opts = options || {};
    this.ttlMs = toPositiveInt(opts.ttlMs, 60000);
    this.refreshIntervalMs = toPositiveInt(opts.refreshIntervalMs, 60000);
    this.parallelism = toPositiveInt(opts.parallelism, 2);
    this.snapshotPath = String(opts.snapshotPath || "").trim();
    this.logger = opts.logger || console;
    this.loaders = new Map(Object.entries(opts.loaders || {}));
    this.entries = new Map();
    this.inFlight = new Map();
    this.intervalHandle = null;
    this.snapshotTimer = null;

    if (this.snapshotPath && opts.loadSnapshot !== false) {
      this.loadSnapshotSync();
    }
  }

  has(key) {
    return this.loaders.has(key);
  }

  getKeys() {
    return Array.from(this.loaders.keys());
  }

  isFresh(entry, nowMs) {
    return !!entry && entry.payload !== undefined && (nowMs - entry.generatedAtMs) < this.ttlMs;
  }

  toResult(entry, cacheStatus) {
    return {
      payload: entry.payload,
      cacheStatus: cacheStatus,
      generatedAt: new Date(entry.generatedAtMs).toISOString()
    };
  }

  async get(key) {
    const entry = this.entries.get(key);
    const nowMs = Date.now();

    if (this.isFresh(entry, nowMs)) {
      return this.toResult(entry, "hit");
    }

    if (entry && entry.payload !== undefined) {
      this.refreshInBackground(key);
      return this.toResult(entry, "stale");
    }

    const refreshed = await this.refresh(key);
    return this.toResult(refreshed, "miss");
  }

  refreshInBackground(key) {
    this.refresh(key).catch((error) => {
      this.log("warn", "[public-data-cache] Refresh failed for " + key + ":", error);
    });
  }

  async refresh(key) {
    if (this.inFlight.has(key)) {
      return this.inFlight.get(key);
    }

    const loader = this.loaders.get(key);
    if (typeof loader !== "function") {
      throw new Error("Unknown public data cache key: " + key);
    }

    const promise = Promise.resolve()
      .then(loader)
      .then((payload) => {
        const entry = createEntry(payload, Date.now());
        this.entries.set(key, entry);
        this.scheduleSnapshotSave();
        return entry;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }

  async warmupAll() {
    const keys = this.getKeys();
    let refreshed = 0;
    await runLimited(keys, this.parallelism, async (key) => {
      try {
        await this.refresh(key);
        refreshed += 1;
      } catch (error) {
        this.log("warn", "[public-data-cache] Warmup failed for " + key + ":", error);
      }
    });
    this.log("info", "[public-data-cache] Warmup complete: " + refreshed + "/" + keys.length + " datasets refreshed.");
    return refreshed;
  }

  start() {
    if (this.intervalHandle) {
      return;
    }

    this.warmupAll().catch((error) => {
      this.log("warn", "[public-data-cache] Initial warmup failed:", error);
    });

    if (this.refreshIntervalMs > 0) {
      this.intervalHandle = setInterval(() => {
        this.warmupAll().catch((error) => {
          this.log("warn", "[public-data-cache] Scheduled warmup failed:", error);
        });
      }, this.refreshIntervalMs);
      if (typeof this.intervalHandle.unref === "function") {
        this.intervalHandle.unref();
      }
    }
  }

  async stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    await this.saveSnapshot();
  }

  loadSnapshotSync() {
    try {
      if (!fs.existsSync(this.snapshotPath)) {
        return;
      }

      const raw = fs.readFileSync(this.snapshotPath, "utf8");
      const snapshot = JSON.parse(raw);
      if (!snapshot || snapshot.version !== SNAPSHOT_VERSION || !snapshot.entries) {
        return;
      }

      Object.keys(snapshot.entries).forEach((key) => {
        if (!this.has(key)) {
          return;
        }
        const savedEntry = snapshot.entries[key];
        const generatedAtMs = normalizeGeneratedAt(savedEntry && savedEntry.generatedAt);
        if (!generatedAtMs || !savedEntry || savedEntry.payload === undefined) {
          return;
        }
        this.entries.set(key, createEntry(savedEntry.payload, generatedAtMs));
      });

      this.log("info", "[public-data-cache] Loaded snapshot entries: " + this.entries.size + ".");
    } catch (error) {
      this.log("warn", "[public-data-cache] Snapshot load failed:", error);
    }
  }

  scheduleSnapshotSave() {
    if (!this.snapshotPath || this.snapshotTimer) {
      return;
    }

    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      this.saveSnapshot().catch((error) => {
        this.log("warn", "[public-data-cache] Snapshot save failed:", error);
      });
    }, 250);

    if (typeof this.snapshotTimer.unref === "function") {
      this.snapshotTimer.unref();
    }
  }

  async saveSnapshot() {
    if (!this.snapshotPath) {
      return;
    }

    const entries = {};
    this.getKeys().forEach((key) => {
      const entry = this.entries.get(key);
      if (!entry || entry.payload === undefined) {
        return;
      }
      entries[key] = {
        generatedAt: new Date(entry.generatedAtMs).toISOString(),
        payload: entry.payload
      };
    });

    const payload = JSON.stringify({
      version: SNAPSHOT_VERSION,
      savedAt: new Date().toISOString(),
      entries: entries
    });

    const dir = path.dirname(this.snapshotPath);
    const tempPath = this.snapshotPath + ".tmp";
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(tempPath, payload, "utf8");
    await fs.promises.rename(tempPath, this.snapshotPath);
  }

  log(level) {
    if (!this.logger || typeof this.logger[level] !== "function") {
      return;
    }
    this.logger[level].apply(this.logger, Array.prototype.slice.call(arguments, 1));
  }
}

function createDefaultLoaders() {
  const loaders = {};

  loaders[PLAYERS_LIST_KEY] = async function () {
    const rows = await getPlayersList();
    return {
      count: rows.length,
      rows: rows
    };
  };

  loaders[MSBL_CLUBS_KEY] = async function () {
    const rows = await getMsblClubs();
    return {
      game: "msbl",
      count: rows.length,
      rows: rows
    };
  };

  loaders[COMPETITIVE_SEASON_KEY] = getCompetitiveSeasonStatus;

  PUBLIC_LEADERBOARD_VARIANTS.forEach(function (variant) {
    loaders[leaderboardCacheKey(variant.game, variant.mode)] = async function () {
      const rows = await getLeaderboardRows({
        gameCode: variant.game,
        modeCode: variant.mode,
        limit: PUBLIC_LEADERBOARD_LIMIT,
        offset: 0
      });
      return {
        game: variant.game,
        mode: variant.mode,
        count: rows.length,
        rows: rows
      };
    };
  });

  return loaders;
}

function createPublicDataCache(options) {
  const opts = options || {};
  return new PublicDataCache({
    ttlMs: opts.ttlMs || config.publicDataCacheTtlMs,
    refreshIntervalMs: opts.refreshIntervalMs || config.publicDataCacheRefreshIntervalMs,
    parallelism: opts.parallelism || config.publicDataCacheParallelism,
    snapshotPath: opts.snapshotPath !== undefined ? opts.snapshotPath : config.publicDataCacheSnapshotPath,
    loaders: opts.loaders || createDefaultLoaders(),
    logger: opts.logger || console,
    loadSnapshot: opts.loadSnapshot
  });
}

function isPublicLeaderboardVariant(game, mode) {
  const key = leaderboardCacheKey(game, mode);
  return PUBLIC_LEADERBOARD_VARIANTS.some(function (variant) {
    return leaderboardCacheKey(variant.game, variant.mode) === key;
  });
}

const publicDataCache = createPublicDataCache();

module.exports = {
  PublicDataCache,
  PLAYERS_LIST_KEY,
  MSBL_CLUBS_KEY,
  COMPETITIVE_SEASON_KEY,
  PUBLIC_LEADERBOARD_LIMIT,
  PUBLIC_LEADERBOARD_VARIANTS,
  createPublicDataCache,
  isPublicLeaderboardVariant,
  leaderboardCacheKey,
  publicDataCache
};
