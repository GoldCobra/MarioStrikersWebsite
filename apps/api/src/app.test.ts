import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "./app.ts";
import { COMPETITIVE_SEASON_KEY } from "./cache/public-data-keys.ts";
import { loadConfig } from "./config.ts";
import { createFixtureDataSource } from "./fixtures/data-source.ts";
import { cookiePair, createTestApp } from "./test-support/app.ts";

test("unexpected errors answer generically without internals and leave the API running", async () => {
  const sqlError = new Error("Invalid object name 'dbo.Players'.");
  const { app, data } = await createTestApp({
    data: {
      getPlayerProfile: () => Promise.reject(sqlError),
      getPlayerProfileByDiscordId: () => Promise.reject(sqlError),
    },
  });
  const sessions = data.login?.sessions;
  assert.ok(sessions);
  const cookie = cookiePair(sessions.createSessionCookie({ id: "900000000000000001" }));
  for (const request of [{ url: "/api/players/1/profile" }, { url: "/api/profile/me", headers: { cookie } }]) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 500, request.url);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(response.json(), { error: "Internal server error.", code: "INTERNAL" });
  }
  assert.equal((await app.inject("/api/health")).statusCode, 200);
});

test("health reports the data source and hides database errors", async () => {
  const { app } = await createTestApp();
  const ok = await app.inject("/api/health");
  assert.equal(ok.headers["x-data-source"], "fixtures");
  assert.equal(ok.headers["access-control-allow-origin"], "*");
  assert.deepEqual(ok.json(), { status: "ok", source: "fixtures" });

  const failing = await createTestApp({
    data: { healthCheck: () => Promise.reject(new Error("Login failed for user 'sa'.")) },
  });
  const response = await failing.app.inject("/api/health");
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { status: "error", source: "fixtures", error: "Database unavailable." });
});

test("season responses keep cached data but send a fresh clock without mutating the snapshot", async () => {
  const oldTime = "2026-09-13T11:00:00.000Z";
  const season = Object.freeze({ id: 1, displayName: "Sample Season", endDateUtc: "2026-10-01T00:00:00.000Z" });
  const payload = Object.freeze({ serverNowUtc: oldTime, season });
  const clock = { now: Date.parse("2026-09-13T12:00:00.000Z") };
  const { app } = await createTestApp({
    data: {
      now: () => clock.now,
      publicData: {
        get: (key) => {
          assert.equal(key, COMPETITIVE_SEASON_KEY);
          return Promise.resolve({ payload, generatedAt: oldTime, cacheStatus: "stale" });
        },
      },
    },
  });
  for (const time of [clock.now, clock.now + 120_000]) {
    clock.now = time;
    const response = await app.inject("/api/competitive-season/current");
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["x-data-generated-at"], oldTime);
    assert.equal(response.headers["x-data-cache"], "stale");
    assert.deepEqual(response.json(), {
      server_now_utc: new Date(time).toISOString(),
      season: { id: 1, display_name: "Sample Season", end_date_utc: "2026-10-01T00:00:00.000Z" },
    });
  }
  assert.equal(payload.serverNowUtc, oldTime);
});

test("the API serves only /api routes, never pages or repository files", async () => {
  const { app } = await createTestApp();
  for (const url of [
    "/",
    "/players",
    "/pages/players.html",
    "/css/global.css",
    "/robots.txt",
    "/package.json",
    "/apps/api/package.json",
    "/src/config.ts",
    "/.env",
    "/.git/config",
    "/docker-compose.prod.yml",
    "/api/unknown",
  ]) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 404, url);
    assert.equal(response.headers["cache-control"], "no-store", url);
    assert.deepEqual(response.json(), { error: "Not found.", code: "NOT_FOUND" }, url);
  }
});

test("routes match with a trailing slash and in any letter case, like the previous API", async () => {
  const { app } = await createTestApp();
  for (const url of ["/api/players/", "/API/PLAYERS", "/api/Leaderboards/msbl/elo1v1?limit=1"]) {
    assert.equal((await app.inject(url)).statusCode, 200, url);
  }
});

test("oversized and malformed request bodies are client errors", async () => {
  const { app } = await createTestApp();
  const oversized = await app.inject({
    method: "POST",
    url: "/api/auth/logout",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ padding: "x".repeat(20_000) }),
  });
  assert.equal(oversized.statusCode, 413);
  const malformed = await app.inject({
    method: "POST",
    url: "/api/auth/logout",
    headers: { "content-type": "application/json" },
    payload: "{",
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(typeof malformed.json<{ code: unknown }>().code, "string");
});

test("production refuses the fixture data source", async () => {
  const config = loadConfig(
    { NODE_ENV: "production", MSSQL_HOST: "db", MSSQL_DATABASE: "d", MSSQL_USER: "u", MSSQL_PASSWORD: "p" },
    { isolated: true },
  );
  await assert.rejects(buildApp({ config, data: createFixtureDataSource() }), /cannot run in production/);
});
