import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import test from "node:test";
import { adminConfigProblems, isAdminConfigured, isDiscordLoginConfigured, loadConfig, loadEnvFile } from "./config.ts";

const PRODUCTION_DB = {
  NODE_ENV: "production",
  MSSQL_HOST: "db",
  MSSQL_DATABASE: "d",
  MSSQL_USER: "u",
  MSSQL_PASSWORD: "p",
};

test(".env.example lists exactly the variables the configuration reads", () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, "config.ts"), "utf8");
  const read = new Set(
    [...source.matchAll(/read(?:String|Int|Bool|List|LogLevel)\(env, "([A-Z0-9_]+)"/g)].map((match) => match[1]),
  );
  read.delete("BOT_TOKEN"); // documented as an alias of DISCORD_BOT_TOKEN
  const example = parseEnv(fs.readFileSync(path.join(import.meta.dirname, "..", ".env.example"), "utf8"));
  assert.deepEqual(Object.keys(example).sort(), [...read].sort());
});

test("defaults keep the previous API's behavior outside production", () => {
  const config = loadConfig({}, { cwd: "/srv/api" });
  assert.equal(config.production, false);
  assert.equal(config.logLevel, "warn");
  assert.equal(config.port, 8787);
  assert.equal(config.corsOrigin, "*");
  assert.equal(config.rateLimitEnabled, false);
  assert.equal(config.trustProxyHops, 0);
  assert.equal(config.session.cookieSecure, false);
  assert.equal(config.mssql.trustServerCertificate, true);
  assert.equal(config.mssql.tlsMinVersion, "TLSv1");
  assert.equal(config.publicDataCache.snapshotPath, path.resolve("/srv/api", ".cache/public-data-cache.json"));
  assert.equal(loadConfig({}, { isolated: true }).publicDataCache.snapshotPath, "");
  assert.equal(isDiscordLoginConfigured(config), false);
});

test("production enables its safeguards and fails fast on missing or weak settings", () => {
  const config = loadConfig(PRODUCTION_DB);
  assert.equal(config.logLevel, "info");
  assert.equal(config.rateLimitEnabled, true);
  assert.equal(config.session.cookieSecure, true);
  assert.throws(
    () => loadConfig({ NODE_ENV: "production" }),
    /Missing MSSQL config: MSSQL_HOST, MSSQL_DATABASE, MSSQL_USER, MSSQL_PASSWORD/,
  );
  assert.throws(() => loadConfig({ ...PRODUCTION_DB, SESSION_SECRET: "short" }), /at least 32 characters/);
  assert.equal(loadConfig({ ...PRODUCTION_DB, SESSION_SECRET: "x".repeat(32) }).session.secret.length, 32);
  assert.throws(() => loadConfig({ MSSQL_TLS_MIN_VERSION: "SSLv3" }), /MSSQL_TLS_MIN_VERSION/);
  assert.throws(() => loadConfig({ LOG_LEVEL: "verbose" }), /LOG_LEVEL/);
  assert.equal(loadConfig({ RATE_LIMIT_ENABLED: "false", ...PRODUCTION_DB }).rateLimitEnabled, false);
});

test("Discord login needs the OAuth application, the guild and a session secret", () => {
  const env = {
    DISCORD_CLIENT_ID: "id",
    DISCORD_CLIENT_SECRET: "secret",
    DISCORD_REDIRECT_URI: "http://localhost/cb",
    DISCORD_GUILD_ID: "1",
    SESSION_SECRET: "s",
  };
  assert.equal(isDiscordLoginConfigured(loadConfig(env)), true);
  for (const key of Object.keys(env)) {
    assert.equal(isDiscordLoginConfigured(loadConfig({ ...env, [key]: "" })), false, key);
  }
  assert.equal(loadConfig({ BOT_TOKEN: "alias" }).discord.botToken, "alias");
});

test("the admin page is off unless switched on and completely configured", () => {
  const login = {
    DISCORD_CLIENT_ID: "id",
    DISCORD_CLIENT_SECRET: "secret",
    DISCORD_REDIRECT_URI: "http://localhost/cb",
    DISCORD_GUILD_ID: "268737069939949569",
    SESSION_SECRET: "s",
    DISCORD_BOT_TOKEN: "bot",
  };
  const env = {
    ...login,
    ADMIN_ENABLED: "true",
    ADMIN_ROLE_IDS: " 1070908166725967942 ,902508392227176489,",
    ADMIN_PATH_TOKEN: "a".repeat(22),
  };
  const config = loadConfig(env);
  assert.equal(isAdminConfigured(config), true);
  assert.deepEqual(config.admin.roleIds, ["1070908166725967942", "902508392227176489"]);
  assert.equal(config.admin.roleCacheTtlMs, 60_000);
  assert.equal(config.admin.sessionMaxAgeMs, 12 * 60 * 60 * 1000);

  // Off by default, even when complete; nothing else is required while it is off.
  assert.equal(isAdminConfigured(loadConfig({ ...env, ADMIN_ENABLED: "" })), false);
  assert.equal(isAdminConfigured(loadConfig({})), false);
  // Every missing or weak setting keeps it off and is named, never shown.
  for (const [key, value, problem] of [
    ["DISCORD_BOT_TOKEN", "", "DISCORD_BOT_TOKEN"],
    ["SESSION_SECRET", "", "Discord login (DISCORD_* and SESSION_SECRET)"],
    ["ADMIN_ROLE_IDS", "", "ADMIN_ROLE_IDS"],
    ["ADMIN_ROLE_IDS", "Admin", "ADMIN_ROLE_IDS"],
    ["ADMIN_ROLE_IDS", "1070908166725967942,<@&1>", "ADMIN_ROLE_IDS"],
    ["ADMIN_PATH_TOKEN", "", "ADMIN_PATH_TOKEN"],
    ["ADMIN_PATH_TOKEN", "admin", "ADMIN_PATH_TOKEN"],
    ["ADMIN_PATH_TOKEN", `${"a".repeat(21)}/`, "ADMIN_PATH_TOKEN"],
    ["ADMIN_SESSION_MAX_AGE_MS", "0", "ADMIN_SESSION_MAX_AGE_MS"],
  ] as const) {
    const broken = loadConfig({ ...env, [key]: value });
    assert.equal(isAdminConfigured(broken), false, `${key}=${value}`);
    assert.deepEqual(adminConfigProblems(broken), [problem], `${key}=${value}`);
  }
  // Role checks are cached between one second and five minutes.
  assert.equal(loadConfig({ ADMIN_ROLE_CACHE_TTL_MS: "0" }).admin.roleCacheTtlMs, 1000);
  assert.equal(loadConfig({ ADMIN_ROLE_CACHE_TTL_MS: "3600000" }).admin.roleCacheTtlMs, 300_000);
});

test("loadEnvFile adds variables without overriding the real environment", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strikers-env-"));
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, 'PORT=9000\nMSSQL_HOST=from-file\n# comment\nQUOTED="a b"\n');
  const env: NodeJS.ProcessEnv = { PORT: "8787" };
  loadEnvFile(file, env);
  loadEnvFile(path.join(dir, "missing.env"), env);
  assert.deepEqual(env, { PORT: "8787", MSSQL_HOST: "from-file", QUOTED: "a b" });
  fs.rmSync(dir, { recursive: true, force: true });
});
