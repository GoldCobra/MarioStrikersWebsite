const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { PUBLIC_LEADERBOARD_VARIANTS } = require("./lib/public-data-keys");

const devPath = path.join(__dirname, "dev.js");
const configPath = path.join(__dirname, "config.js");
let child;
let base;
let tempDir;

function childEnvironment(overrides) {
  const env = { ...process.env, NODE_ENV: "development", PORT: "0", DEV_HOST: "127.0.0.1",
    MSSQL_HOST: "must-not-contact.example.test", MSSQL_DATABASE: "fake", MSSQL_USER: "fake", MSSQL_PASSWORD: "fake",
    DISCORD_CLIENT_SECRET: "must-not-use", DISCORD_BOT_TOKEN: "must-not-use", BOT_TOKEN: "must-not-use",
    ...overrides };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  delete env.CORS_ORIGIN;
  return env;
}

before(async function () {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "strikers-dev-smoke-"));
  await fs.writeFile(path.join(tempDir, ".env"), "CORS_ORIGIN=dotenv-must-not-be-read\nMSSQL_HOST=dotenv-must-not-be-read\n");
  child = spawn(process.execPath, [devPath], { cwd: tempDir, env: childEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
  base = await new Promise(function (resolve, reject) {
    let output = "";
    const timer = setTimeout(function () { reject(new Error("Dev startup timed out: " + output)); }, 10000);
    child.on("error", function (error) { clearTimeout(timer); reject(error); });
    child.on("exit", function (code) { clearTimeout(timer); reject(new Error("Dev exited early: " + code + " " + output)); });
    child.stderr.on("data", function (chunk) { output += chunk; });
    child.stdout.on("data", function (chunk) {
      output += chunk;
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timer); resolve("http://127.0.0.1:" + match[1]); }
    });
  });
});

after(async function () {
  if (child && child.exitCode === null) {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

test("fixture startup ignores .env and serves clearly marked sample data", async function () {
  const response = await fetch(base + "/api/health");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("x-data-source"), "fixtures");
  assert.deepEqual(await response.json(), { status: "ok", source: "fixtures" });
  const page = await fetch(base + "/");
  assert.match(await page.text(), /synthetic sample data/);
});

test("all public API families return populated fixture contracts", async function () {
  for (const variant of PUBLIC_LEADERBOARD_VARIANTS) {
    const response = await fetch(base + "/api/leaderboards/" + variant.game + "/" + variant.mode + "?limit=2");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.game, variant.game);
    assert.equal(body.mode, variant.mode);
    assert.equal(body.rows.length, 2);
    assert.equal(body.rows[0].display_name, "Sample Player");
  }
  const paginated = await (await fetch(base + "/api/leaderboards/msbl/elo1v1?limit=1&offset=1")).json();
  assert.equal(paginated.rows.length, 1);
  assert.equal(paginated.rows[0].player_id, 2);
  const top = await (await fetch(base + "/api/leaderboards/msbl/elo1v1/top?limit=1")).json();
  assert.equal(top.count, 1);
  for (const route of ["/api/players", "/api/clubs", "/api/clubs/msbl", "/api/events/community"]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    const data = await response.json();
    assert.ok(data.count > 0, route);
    assert.equal(data.count, data.rows.length, route);
  }
  const profile = await (await fetch(base + "/api/players/1/profile")).json();
  assert.equal(profile.player.name, "Sample Player");
  assert.ok(profile.ratings.msbl.rating > 0);
  assert.equal(profile.ratings.msbl.season_reward_level.current_wins, 3);
  assert.equal(profile.ratings.msbl.season_reward_level.required_wins, 10);
  const club = await (await fetch(base + "/api/clubs/msbl/1/profile")).json();
  assert.equal(club.club.name, "Sample Strikers");
  assert.equal(club.club.join_conditions, "Open to Anyone");
  assert.ok(club.roster.length > 0);
  const logo = await fetch(base + "/api/clubs/msbl/1/logo");
  assert.match(logo.headers.get("content-type"), /image\/svg\+xml/);
  assert.match(await logo.text(), /SAMPLE/);
  const season = await (await fetch(base + "/api/competitive-season/current")).json();
  assert.equal(season.season.displayName, "Sample Season");
  const wiimmfi = await (await fetch(base + "/api/wiimmfi/msc-charged")).json();
  assert.equal(wiimmfi.players[0].name, "Sample Player");
  assert.equal((await fetch(base + "/api/players/9999/profile")).status, 404);
  assert.equal((await fetch(base + "/api/clubs/msbl/9999/profile")).status, 404);
  assert.equal((await fetch(base + "/api/clubs/msbl/9999/logo")).status, 404);
  assert.equal((await fetch(base + "/api/leaderboards/invalid/elo1v1")).status, 400);
});

test("sample login and logout use local callbacks and isolated signed cookies", async function () {
  assert.deepEqual(await (await fetch(base + "/api/auth/me")).json(), { authenticated: false });
  assert.equal((await fetch(base + "/api/profile/me")).status, 401);
  const start = await fetch(base + "/api/auth/discord/start?returnTo=%2Fprofile", { redirect: "manual" });
  assert.equal(start.status, 302);
  assert.ok(start.headers.get("location").startsWith("/api/auth/discord/callback?"));
  const callback = await fetch(base + start.headers.get("location"), { redirect: "manual" });
  assert.equal(callback.headers.get("location"), "/profile?auth=success");
  const cookie = callback.headers.get("set-cookie").split(";")[0];
  assert.ok(cookie.startsWith("msc_dev_session="));
  const signedIn = await (await fetch(base + "/api/auth/me", { headers: { cookie } })).json();
  assert.equal(signedIn.authenticated, true);
  assert.equal(signedIn.user.global_name, "Sample Player");
  const profile = await (await fetch(base + "/api/profile/me", { headers: { cookie } })).json();
  assert.equal(profile.profile.player.id, 1);
  const tampered = cookie.slice(0, -1) + (cookie.endsWith("x") ? "y" : "x");
  assert.equal((await (await fetch(base + "/api/auth/me", { headers: { cookie: tampered } })).json()).authenticated, false);
  const logout = await fetch(base + "/api/auth/logout", { method: "POST", headers: { cookie } });
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  const clearedCookie = logout.headers.get("set-cookie").split(";")[0];
  assert.equal((await (await fetch(base + "/api/auth/me", { headers: { cookie: clearedCookie } })).json()).authenticated, false);
  assert.equal((await fetch(base + "/api/auth/discord/callback?code=sample&state=invalid")).status, 400);
  const external = await fetch(base + "/api/auth/discord/start?returnTo=https%3A%2F%2Fexample.com", { redirect: "manual" });
  const safeCallback = await fetch(base + external.headers.get("location"), { redirect: "manual" });
  assert.equal(safeCallback.headers.get("location"), "/profile?auth=success");
});

test("static serving permits public assets and clean routes, and hides repository files", async function () {
  for (const route of ["/players", "/msbl-elo1v1", "/msbl-striker-clubs", "/profile", "/msbl-save-editor",
    "/msc-save-editor", "/css/global.css", "/js/global-nav.js", "/pages/templates/player-profile-popup.html", "/robots.txt", "/sitemap.xml"]) {
    assert.equal((await fetch(base + route)).status, 200, route);
  }
  const legacy = await fetch(base + "/pages/players.html?sample=1", { redirect: "manual" });
  assert.equal(legacy.status, 301);
  assert.equal(legacy.headers.get("location"), "/players?sample=1");
  for (const route of ["/backend/package.json", "/backend/src/config.js", "/README.md", "/.env", "/.git/config",
    "/docs/development.md", "/docker-compose.prod.yml", "/css/../backend/package.json"]) {
    assert.equal((await fetch(base + route)).status, 404, route);
  }
});

test("fixture process drops live credentials, blocks outgoing calls, and never loads database services", function () {
  const script = `const {start}=require(${JSON.stringify(devPath)});
    const server=start();
    const {config}=require(${JSON.stringify(configPath)});
    const assert=require('node:assert/strict');
    assert.equal(config.mssqlHost,''); assert.equal(config.discordBotToken,'');
    assert.equal(config.discordClientSecret,''); assert.equal(config.publicDataCacheSnapshotPath,'');
    assert.ok(!Object.keys(require.cache).some(p=>/[\\/]db\.js$|[\\/]public-data-cache\.js$/.test(p)));
    assert.throws(()=>fetch('https://discord.com/api/v10/users/@me'),/External connections/);
    assert.throws(()=>require('node:net').connect(1433,'example.test'),/External connections/);
    server.on('listening',()=>server.close());`;
  const result = spawnSync(process.execPath, ["-e", script], { cwd: tempDir, env: childEnvironment(), encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
});

test("production entrypoints reject fixtures and regular production startup keeps live providers", function () {
  for (const entry of [devPath, path.join(__dirname, "index.js")]) {
    const result = spawnSync(process.execPath, [entry], { env: childEnvironment({ NODE_ENV: "production", MSC_DEV_FIXTURES: "1" }), encoding: "utf8", timeout: 10000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cannot run in production/);
  }
  const script = `process.env.NODE_ENV='production';
    const {createApp}=require(${JSON.stringify(path.join(__dirname, "server.js"))});
    require('node:assert/strict').throws(()=>createApp({providers:{source:'fixtures'}}),/cannot run in production/);
    const app=createApp(); require('node:assert/strict').equal(typeof app,'function');`;
  const env = childEnvironment({ NODE_ENV: "production", MSC_DEV_FIXTURES: "0" });
  const result = spawnSync(process.execPath, ["-e", script], { cwd: tempDir, env, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
});

test("isolated test configuration ignores local dotenv while honoring explicit fake overrides", function () {
  const script = `const {config}=require(${JSON.stringify(configPath)});
    const assert=require('node:assert/strict'); assert.equal(config.corsOrigin,'*');
    assert.equal(config.mssqlHost,'explicit-test-host'); assert.equal(config.publicDataCacheSnapshotPath,'');`;
  const result = spawnSync(process.execPath, ["-e", script], { cwd: tempDir,
    env: childEnvironment({ NODE_ENV: "test", MSSQL_HOST: "explicit-test-host" }), encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
});

test("occupied development port produces a clear error without stopping the existing server", async function () {
  const result = spawnSync(process.execPath, [devPath], { cwd: tempDir,
    env: childEnvironment({ PORT: new URL(base).port }), encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /already in use/);
  assert.equal((await fetch(base + "/api/health")).status, 200);
});
