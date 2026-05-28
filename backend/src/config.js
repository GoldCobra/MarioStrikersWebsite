const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function readInt(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") {
    return defaultValue;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

const config = {
  port: readInt("PORT", 8787),
  flareSolverrUrl: process.env.FLARESOLVERR_URL || "http://localhost:8191",
  corsOrigin: process.env.CORS_ORIGIN || "*",
  leaderboardDefaultLimit: readInt("LEADERBOARD_DEFAULT_LIMIT", 100),
  leaderboardMaxLimit: readInt("LEADERBOARD_MAX_LIMIT", 500),
  publicDataCacheTtlMs: readInt("PUBLIC_DATA_CACHE_TTL_MS", 60000),
  publicDataCacheRefreshIntervalMs: readInt("PUBLIC_DATA_CACHE_REFRESH_INTERVAL_MS", 60000),
  publicDataCacheParallelism: readInt("PUBLIC_DATA_CACHE_PARALLELISM", 2),
  publicDataCacheSnapshotPath: process.env.PUBLIC_DATA_CACHE_SNAPSHOT_PATH || path.resolve(process.cwd(), ".cache/public-data-cache.json"),
  mssqlHost: process.env.MSSQL_HOST || "",
  mssqlPort: readInt("MSSQL_PORT", 443),
  mssqlDatabase: process.env.MSSQL_DATABASE || "",
  mssqlUser: process.env.MSSQL_USER || "",
  mssqlPassword: process.env.MSSQL_PASSWORD || ""
};

function assertMssqlConfigured() {
  const missing = [];
  if (!config.mssqlHost) missing.push("MSSQL_HOST");
  if (!config.mssqlDatabase) missing.push("MSSQL_DATABASE");
  if (!config.mssqlUser) missing.push("MSSQL_USER");
  if (!config.mssqlPassword) missing.push("MSSQL_PASSWORD");
  if (missing.length) {
    throw new Error("Missing MSSQL config: " + missing.join(", "));
  }
}

module.exports = { config, assertMssqlConfigured };
