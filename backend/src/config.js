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

function readBool(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") {
    return defaultValue;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return defaultValue;
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
  clubLogoCachePath: process.env.CLUB_LOGO_CACHE_PATH || path.resolve(process.cwd(), ".cache/club-logos"),
  clubLogoMaxBytes: readInt("CLUB_LOGO_MAX_BYTES", 5 * 1024 * 1024),
  clubLogoFetchTimeoutMs: readInt("CLUB_LOGO_FETCH_TIMEOUT_MS", 15000),
  clubLogoFailureRetryMs: readInt("CLUB_LOGO_FAILURE_RETRY_MS", 6 * 60 * 60 * 1000),
  discordClientId: process.env.DISCORD_CLIENT_ID || "",
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET || "",
  discordRedirectUri: process.env.DISCORD_REDIRECT_URI || "",
  discordGuildId: process.env.DISCORD_GUILD_ID || "",
  discordApiBase: process.env.DISCORD_API_BASE || "https://discord.com/api/v10",
  discordBotToken: process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN || "",
  discordMemberCacheTtlMs: readInt("DISCORD_MEMBER_CACHE_TTL_MS", 60 * 60 * 1000),
  discordMemberFailureCacheTtlMs: readInt("DISCORD_MEMBER_FAILURE_CACHE_TTL_MS", 60 * 1000),
  discordMemberFetchTimeoutMs: readInt("DISCORD_MEMBER_FETCH_TIMEOUT_MS", 5000),
  discordMemberFetchParallelism: readInt("DISCORD_MEMBER_FETCH_PARALLELISM", 4),
  sessionSecret: process.env.SESSION_SECRET || "",
  sessionCookieName: process.env.SESSION_COOKIE_NAME || "msc_session",
  sessionCookieSecure: readBool("SESSION_COOKIE_SECURE", process.env.NODE_ENV === "production"),
  sessionTtlMs: readInt("SESSION_TTL_MS", 7 * 24 * 60 * 60 * 1000),
  authStateTtlMs: readInt("AUTH_STATE_TTL_MS", 10 * 60 * 1000),
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

function assertDiscordAuthConfigured() {
  const missing = [];
  if (!config.discordClientId) missing.push("DISCORD_CLIENT_ID");
  if (!config.discordClientSecret) missing.push("DISCORD_CLIENT_SECRET");
  if (!config.discordRedirectUri) missing.push("DISCORD_REDIRECT_URI");
  if (!config.discordGuildId) missing.push("DISCORD_GUILD_ID");
  if (!config.sessionSecret) missing.push("SESSION_SECRET");
  if (missing.length) {
    throw new Error("Missing Discord auth config: " + missing.join(", "));
  }
}

module.exports = { config, assertMssqlConfigured, assertDiscordAuthConfigured };
