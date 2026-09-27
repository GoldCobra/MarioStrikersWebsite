// Typed configuration, read once at startup. Every variable is listed in .env.example; a test keeps
// the two in sync. Production fails fast when the database settings are missing or the session secret
// is too short.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

export interface MssqlConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly poolMin: number;
  readonly poolMax: number;
  readonly poolIdleTimeoutMs: number;
  readonly connectionTimeoutMs: number;
  readonly requestTimeoutMs: number;
  /** The shared Arvixe host has used an untrusted certificate; tighten only after probing it. */
  readonly trustServerCertificate: boolean;
  readonly tlsMinVersion: "TLSv1" | "TLSv1.1" | "TLSv1.2" | "TLSv1.3";
}

export interface DiscordConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly guildId: string;
  readonly apiBase: string;
  readonly botToken: string;
  readonly eventsCategoryId: string;
  readonly eventsRefreshIntervalMs: number;
  readonly memberCacheTtlMs: number;
  readonly memberFailureCacheTtlMs: number;
  readonly memberFetchTimeoutMs: number;
  readonly memberFetchParallelism: number;
}

export interface SessionConfig {
  readonly secret: string;
  readonly cookieName: string;
  readonly cookieSecure: boolean;
  readonly ttlMs: number;
  readonly authStateTtlMs: number;
}

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

export interface Config {
  readonly production: boolean;
  /** Production logs requests (info); development and tests only warnings. */
  readonly logLevel: LogLevel;
  readonly port: number;
  readonly host: string;
  /** Reverse proxies in front of the API (production: Caddy and nginx). */
  readonly trustProxyHops: number;
  readonly corsOrigin: string;
  readonly rateLimitEnabled: boolean;
  readonly flareSolverrUrl: string;
  readonly leaderboardDefaultLimit: number;
  readonly leaderboardMaxLimit: number;
  readonly publicDataCache: {
    readonly ttlMs: number;
    readonly refreshIntervalMs: number;
    readonly parallelism: number;
    /** "" disables snapshots (tests and fixtures). */
    readonly snapshotPath: string;
  };
  readonly clubLogos: {
    readonly cachePath: string;
    readonly maxBytes: number;
    readonly fetchTimeoutMs: number;
    readonly failureRetryMs: number;
  };
  readonly discord: DiscordConfig;
  readonly session: SessionConfig;
  readonly mssql: MssqlConfig;
}

type Env = Readonly<Record<string, string | undefined>>;

function readString(env: Env, name: string, fallback = ""): string {
  return env[name] || fallback;
}

function readInt(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBool(env: Env, name: string, fallback: boolean): boolean {
  const raw = (env[name] ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

const LOG_LEVELS: readonly LogLevel[] = ["fatal", "error", "warn", "info", "debug", "trace", "silent"];
const MIN_SESSION_SECRET_LENGTH = 32;

function readLogLevel(env: Env, fallback: LogLevel): LogLevel {
  const value = readString(env, "LOG_LEVEL", fallback);
  const level = LOG_LEVELS.find((candidate) => candidate === value);
  if (!level) throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}, not ${value}.`);
  return level;
}

function readTlsVersion(env: Env): MssqlConfig["tlsMinVersion"] {
  const value = readString(env, "MSSQL_TLS_MIN_VERSION", "TLSv1");
  if (value === "TLSv1" || value === "TLSv1.1" || value === "TLSv1.2" || value === "TLSv1.3") return value;
  throw new Error(`MSSQL_TLS_MIN_VERSION must be TLSv1, TLSv1.1, TLSv1.2 or TLSv1.3, not ${value}.`);
}

export interface LoadConfigOptions {
  readonly cwd?: string;
  /** Fixture and test runs never write cache snapshots. */
  readonly isolated?: boolean;
}

export function loadConfig(env: Env, options: LoadConfigOptions = {}): Config {
  const cwd = options.cwd ?? process.cwd();
  const production = env.NODE_ENV === "production";
  const config: Config = {
    production,
    logLevel: readLogLevel(env, production ? "info" : "warn"),
    port: readInt(env, "PORT", 8787),
    host: readString(env, "HOST", "0.0.0.0"),
    trustProxyHops: readInt(env, "TRUST_PROXY_HOPS", 0),
    corsOrigin: readString(env, "CORS_ORIGIN", "*"),
    rateLimitEnabled: readBool(env, "RATE_LIMIT_ENABLED", production),
    flareSolverrUrl: readString(env, "FLARESOLVERR_URL", "http://localhost:8191"),
    leaderboardDefaultLimit: readInt(env, "LEADERBOARD_DEFAULT_LIMIT", 100),
    leaderboardMaxLimit: readInt(env, "LEADERBOARD_MAX_LIMIT", 500),
    publicDataCache: {
      ttlMs: readInt(env, "PUBLIC_DATA_CACHE_TTL_MS", 60_000),
      refreshIntervalMs: readInt(env, "PUBLIC_DATA_CACHE_REFRESH_INTERVAL_MS", 60_000),
      parallelism: readInt(env, "PUBLIC_DATA_CACHE_PARALLELISM", 2),
      snapshotPath: options.isolated
        ? ""
        : readString(env, "PUBLIC_DATA_CACHE_SNAPSHOT_PATH", resolve(cwd, ".cache/public-data-cache.json")),
    },
    clubLogos: {
      cachePath: readString(env, "CLUB_LOGO_CACHE_PATH", resolve(cwd, ".cache/club-logos")),
      maxBytes: readInt(env, "CLUB_LOGO_MAX_BYTES", 5 * 1024 * 1024),
      fetchTimeoutMs: readInt(env, "CLUB_LOGO_FETCH_TIMEOUT_MS", 15_000),
      failureRetryMs: readInt(env, "CLUB_LOGO_FAILURE_RETRY_MS", 6 * 60 * 60 * 1000),
    },
    discord: {
      clientId: readString(env, "DISCORD_CLIENT_ID"),
      clientSecret: readString(env, "DISCORD_CLIENT_SECRET"),
      redirectUri: readString(env, "DISCORD_REDIRECT_URI"),
      guildId: readString(env, "DISCORD_GUILD_ID"),
      apiBase: readString(env, "DISCORD_API_BASE", "https://discord.com/api/v10"),
      botToken: readString(env, "DISCORD_BOT_TOKEN") || readString(env, "BOT_TOKEN"),
      eventsCategoryId: readString(env, "DISCORD_EVENTS_CATEGORY_ID"),
      eventsRefreshIntervalMs: readInt(env, "DISCORD_EVENTS_REFRESH_INTERVAL_MS", 60 * 60 * 1000),
      memberCacheTtlMs: readInt(env, "DISCORD_MEMBER_CACHE_TTL_MS", 60 * 60 * 1000),
      memberFailureCacheTtlMs: readInt(env, "DISCORD_MEMBER_FAILURE_CACHE_TTL_MS", 60 * 1000),
      memberFetchTimeoutMs: readInt(env, "DISCORD_MEMBER_FETCH_TIMEOUT_MS", 5000),
      memberFetchParallelism: readInt(env, "DISCORD_MEMBER_FETCH_PARALLELISM", 4),
    },
    session: {
      secret: readString(env, "SESSION_SECRET"),
      cookieName: readString(env, "SESSION_COOKIE_NAME", "msc_session"),
      cookieSecure: readBool(env, "SESSION_COOKIE_SECURE", production),
      ttlMs: readInt(env, "SESSION_TTL_MS", 7 * 24 * 60 * 60 * 1000),
      authStateTtlMs: readInt(env, "AUTH_STATE_TTL_MS", 10 * 60 * 1000),
    },
    mssql: {
      host: readString(env, "MSSQL_HOST"),
      port: readInt(env, "MSSQL_PORT", 443),
      database: readString(env, "MSSQL_DATABASE"),
      user: readString(env, "MSSQL_USER"),
      password: readString(env, "MSSQL_PASSWORD"),
      poolMin: readInt(env, "MSSQL_POOL_MIN", 1),
      poolMax: readInt(env, "MSSQL_POOL_MAX", 10),
      poolIdleTimeoutMs: readInt(env, "MSSQL_POOL_IDLE_TIMEOUT_MS", 300_000),
      connectionTimeoutMs: readInt(env, "MSSQL_CONNECTION_TIMEOUT_MS", 15_000),
      requestTimeoutMs: readInt(env, "MSSQL_REQUEST_TIMEOUT_MS", 15_000),
      trustServerCertificate: readBool(env, "MSSQL_TRUST_SERVER_CERTIFICATE", true),
      tlsMinVersion: readTlsVersion(env),
    },
  };
  if (production) {
    assertMssqlConfigured(config.mssql);
    const secretLength = config.session.secret.length;
    if (secretLength > 0 && secretLength < MIN_SESSION_SECRET_LENGTH) {
      throw new Error(`SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters.`);
    }
  }
  return config;
}

export function missingMssqlSettings(mssql: MssqlConfig): string[] {
  const missing: string[] = [];
  if (!mssql.host) missing.push("MSSQL_HOST");
  if (!mssql.database) missing.push("MSSQL_DATABASE");
  if (!mssql.user) missing.push("MSSQL_USER");
  if (!mssql.password) missing.push("MSSQL_PASSWORD");
  return missing;
}

export function assertMssqlConfigured(mssql: MssqlConfig): void {
  const missing = missingMssqlSettings(mssql);
  if (missing.length) throw new Error(`Missing MSSQL config: ${missing.join(", ")}`);
}

/** Discord login needs the OAuth application and a session secret; without them it is switched off. */
export function isDiscordLoginConfigured(config: Config): boolean {
  const { discord, session } = config;
  return Boolean(discord.clientId && discord.clientSecret && discord.redirectUri && discord.guildId && session.secret);
}

/** Adds variables from a .env file without overriding the real environment. */
export function loadEnvFile(path: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!existsSync(path)) return;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(path, "utf8")))) {
    env[key] ??= value;
  }
}
