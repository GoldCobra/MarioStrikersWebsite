const assert = require("node:assert/strict");
const { test } = require("node:test");
const { once } = require("node:events");
const { config } = require("./config");
const { createApp } = require("./server");
const { createFixtureProviders } = require("./dev/fixtures");
const auth = require("./services/auth-service");
const { COMPETITIVE_SEASON_KEY } = require("./lib/public-data-keys");

async function withServer(providers, run) {
  const server = createApp({ providers }).listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await run("http://127.0.0.1:" + server.address().port);
  } finally {
    await new Promise(function (resolve) { server.close(resolve); });
  }
}

test("malformed cookies do not crash the API or invalidate an unrelated valid session", async function (t) {
  t.mock.property(config, "sessionSecret", "local-resilience-test-secret");
  const providers = createFixtureProviders();
  providers.auth = auth;
  await withServer(providers, async function (base) {
    for (const cookie of ["unrelated=%", "msc_session=%", "msc_session=%E0%A4%A", "msc_session=invalid"]) {
      const response = await fetch(base + "/api/profile/me", { headers: { cookie } });
      assert.equal(response.status, 401, cookie);
      assert.equal((await response.json()).code, "AUTH_REQUIRED");
      assert.equal(response.headers.get("cache-control"), "no-store");
      const me = await fetch(base + "/api/auth/me", { headers: { cookie } });
      assert.deepEqual(await me.json(), { authenticated: false });
    }
    const sessionCookie = config.sessionCookieName + "=" + auth.createSignedToken({
      discord_user_id: "900000000000000001", expires_at: Date.now() + 60000
    }, config.sessionSecret);
    for (const cookie of ["unrelated=%; " + sessionCookie, sessionCookie + "; unrelated=%E0%A4%A"]) {
      const response = await fetch(base + "/api/profile/me", { headers: { cookie } });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).profile.player.name, "Sample Player");
    }
    assert.equal((await fetch(base + "/api/health")).status, 200);
  });
});

test("unexpected session errors return JSON and leave the API running", async function (t) {
  t.mock.method(console, "error", function () {});
  const providers = createFixtureProviders();
  providers.auth = { ...providers.auth, readSessionFromRequest: function () { throw new Error("Session test failure."); } };
  await withServer(providers, async function (base) {
    const response = await fetch(base + "/api/profile/me");
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "Session test failure." });
    assert.equal((await fetch(base + "/api/health")).status, 200);
  });
});

test("season responses keep cached data but send a fresh uncached clock without mutating the snapshot", async function (t) {
  const now = Date.parse("2026-09-13T12:00:00.000Z");
  t.mock.timers.enable({ apis: ["Date"], now });
  const season = Object.freeze({ id: 1, displayName: "Sample Season", endDateUtc: "2026-10-01T00:00:00.000Z" });
  const oldTime = "2026-09-13T11:00:00.000Z";
  const payload = Object.freeze({ serverNowUtc: oldTime, season });
  const providers = createFixtureProviders();
  providers.publicDataCache = { get: async function (key) {
    assert.equal(key, COMPETITIVE_SEASON_KEY);
    return { payload, generatedAt: oldTime, cacheStatus: "stale" };
  } };
  await withServer(providers, async function (base) {
    for (const time of [now, now + 120000]) {
      t.mock.timers.setTime(time);
      const response = await fetch(base + "/api/competitive-season/current");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("x-data-generated-at"), oldTime);
      assert.equal(response.headers.get("x-data-cache"), "stale");
      assert.deepEqual(await response.json(), { serverNowUtc: new Date(time).toISOString(), season });
    }
    assert.equal(payload.serverNowUtc, oldTime);
  });
});
