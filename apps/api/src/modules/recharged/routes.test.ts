import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";
import pino from "pino";
import { buildApp } from "../../app.ts";
import { loadConfig } from "../../config.ts";
import { createFixtureDataSource } from "../../fixtures/data-source.ts";
import { TEST_NOW, createTestApp } from "../../test-support/app.ts";
import { digestApiKey } from "./keys.ts";
import { createMemoryRechargedStore, type RankRecord, type RechargedPlayerRecord } from "./service.ts";

const TEST_KEY = "rch_test_" + "t".repeat(43);
const LIVE_KEY = "rch_live_" + "l".repeat(43);
const KEYS_ENV = {
  RECHARGED_API_KEYS: `test:${digestApiKey(TEST_KEY).toString("hex")},live:${digestApiKey(LIVE_KEY).toString("hex")}`,
};
const TEST_AUTH = { authorization: `Bearer ${TEST_KEY}` };
const LIVE_AUTH = { authorization: `Bearer ${LIVE_KEY}` };
const BASE = "/api/recharged/v1";

const ALICE = "195905866527014912";
const BOB = "329703291980087296";
const LADDER: readonly RankRecord[] = [
  { rankNumber: 0, name: "Unranked", tier: "Unranked", minElo: 500 },
  { rankNumber: 1, name: "Bronze I", tier: "Bronze", minElo: 500 },
];
const ALICE_RECORD: RechargedPlayerRecord = {
  playerId: 223,
  name: "GoldCobra",
  hideStats: false,
  season: { id: 3, name: "Dusk Season 2026", endsAt: new Date("2026-12-02T08:00:00.000Z") },
  rating: {
    elo: 812.4,
    rankNumber: 5,
    rankName: "Silver II",
    placementPlayed: 5,
    placementComplete: true,
    wins: 12,
    losses: 7,
  },
  unranked: { elo: 500, name: "Unranked" },
};

const REPORT = {
  match_id: "wfc-000123",
  played_at: "2026-09-13T11:00:00Z",
  player1: { discord_id: ALICE, score: 2 },
  player2: { discord_id: BOB, score: 1 },
};

async function createRechargedApp(env: Readonly<Record<string, string>> = KEYS_ENV) {
  const recharged = createMemoryRechargedStore({
    players: (discordId) => (discordId === ALICE ? ALICE_RECORD : null),
    ranks: LADDER,
    now: () => Date.parse(TEST_NOW),
  });
  return (await createTestApp({ env, data: { recharged } })).app;
}

const ROUTES = [
  { method: "GET" as const, url: `${BASE}/players/${ALICE}` },
  { method: "GET" as const, url: `${BASE}/ranks` },
  { method: "POST" as const, url: `${BASE}/matches`, payload: REPORT },
  { method: "GET" as const, url: `${BASE}/matches/wfc-000123` },
];

test("without RECHARGED_API_KEYS, or with a wrong one, no route exists", async () => {
  const settings: readonly Readonly<Record<string, string>>[] = [
    {},
    { RECHARGED_API_KEYS: "test:abc" },
    { RECHARGED_API_KEYS: `${KEYS_ENV.RECHARGED_API_KEYS},x` },
  ];
  for (const env of settings) {
    const app = await createRechargedApp(env);
    for (const route of ROUTES) {
      for (const headers of [{}, TEST_AUTH]) {
        const response = await app.inject({ ...route, headers });
        assert.equal(response.statusCode, 404, `${route.url} ${JSON.stringify(env)}`);
        assert.deepEqual(response.json(), { error: "Not found.", code: "NOT_FOUND" });
      }
    }
    await app.close();
  }
});

test("a wrong RECHARGED_API_KEYS is logged by its entries' positions, never their values", async () => {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const broken = `${KEYS_ENV.RECHARGED_API_KEYS},test:secret-looking-value`;
  const config = loadConfig({ NODE_ENV: "test", RECHARGED_API_KEYS: broken });
  const app = await buildApp({
    config,
    data: createFixtureDataSource({ fixedNow: TEST_NOW }),
    loggerInstance: pino({ level: "error" }, stream),
  });
  await app.ready();
  const logged = lines.join("");
  assert.match(logged, /RECHARGED_API_KEYS is set, but the Recharged API stays off/);
  assert.match(logged, /entry 3 is not test:<sha256 hex> or live:<sha256 hex>/);
  assert.doesNotMatch(logged, /secret-looking-value/);
  assert.doesNotMatch(logged, new RegExp(digestApiKey(TEST_KEY).toString("hex")));
  assert.equal((await app.inject({ url: `${BASE}/ranks`, headers: TEST_AUTH })).statusCode, 404);
  await app.close();
});

test("every route needs a configured key", async () => {
  const app = await createRechargedApp();
  for (const route of ROUTES) {
    for (const authorization of [undefined, `Bearer ${TEST_KEY}x`, `Basic ${TEST_KEY}`, TEST_KEY]) {
      const response = await app.inject({ ...route, headers: authorization ? { authorization } : {} });
      assert.equal(response.statusCode, 401, `${route.url} ${String(authorization)}`);
      assert.deepEqual(response.json(), { error: "A valid API key is required.", code: "INVALID_API_KEY" });
      assert.equal(response.headers["www-authenticate"], 'Bearer realm="recharged"');
      assert.equal(response.headers["cache-control"], "no-store");
    }
  }
  await app.close();
});

test("a player's MSC 1v1 rating by Discord id", async () => {
  const app = await createRechargedApp();
  const found = await app.inject({ url: `${BASE}/players/${ALICE}`, headers: TEST_AUTH });
  assert.equal(found.statusCode, 200);
  assert.equal(found.headers["cache-control"], "no-store");
  assert.deepEqual(found.json(), {
    player: {
      discord_id: ALICE,
      player_id: 223,
      name: "GoldCobra",
      stats_hidden: false,
      msc_1v1: {
        season: { id: 3, name: "Dusk Season 2026", ends_at: "2026-12-02T08:00:00.000Z" },
        elo: 812,
        rank: { number: 5, name: "Silver II" },
        placement: { played: 5, required: 5, complete: true },
        wins: 12,
        losses: 7,
      },
    },
  });
  const unknown = await app.inject({ url: `${BASE}/players/${BOB}`, headers: LIVE_AUTH });
  assert.equal(unknown.statusCode, 404);
  assert.deepEqual(unknown.json(), { error: "No player is linked to this Discord account.", code: "PLAYER_NOT_FOUND" });
  for (const id of ["abc", "12345", `<@${ALICE}>`]) {
    const invalid = await app.inject({ url: `${BASE}/players/${encodeURIComponent(id)}`, headers: TEST_AUTH });
    assert.equal(invalid.statusCode, 400, id);
    assert.equal(invalid.json<{ code: string }>().code, "BAD_REQUEST");
  }
  await app.close();
});

test("the rank ladder", async () => {
  const app = await createRechargedApp();
  const response = await app.inject({ url: `${BASE}/ranks`, headers: TEST_AUTH });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    default_elo: 500,
    placement_matches: 5,
    ranks: [
      { number: 0, name: "Unranked", tier: "Unranked", min_elo: 500 },
      { number: 1, name: "Bronze I", tier: "Bronze", min_elo: 500 },
    ],
  });
  await app.close();
});

test("a report is stored once per key environment: 201, the same again 200, other values 409", async () => {
  const app = await createRechargedApp();
  const post = (payload: unknown, headers: Record<string, string> = TEST_AUTH) =>
    app.inject({ method: "POST", url: `${BASE}/matches`, headers, payload: payload as Record<string, unknown> });

  const created = await post(REPORT);
  assert.equal(created.statusCode, 201);
  assert.equal(created.headers["cache-control"], "no-store");
  assert.deepEqual(created.json(), {
    created: true,
    report: {
      match_id: "wfc-000123",
      environment: "test",
      status: "test",
      played_at: "2026-09-13T11:00:00.000Z",
      received_at: TEST_NOW,
      processed_at: null,
      player1: { discord_id: ALICE, score: 2 },
      player2: { discord_id: BOB, score: 1 },
    },
  });

  const again = await post(REPORT);
  assert.equal(again.statusCode, 200);
  assert.equal(again.json<{ created: boolean }>().created, false);

  const conflict = await post({ ...REPORT, player1: { discord_id: ALICE, score: 3 } });
  assert.equal(conflict.statusCode, 409);
  assert.deepEqual(conflict.json(), {
    error: "This match_id was already reported with other values.",
    code: "MATCH_ID_CONFLICT",
  });

  const live = await post(REPORT, LIVE_AUTH);
  assert.equal(live.statusCode, 201, "a live key's reports are apart from a test key's");
  assert.equal(live.json<{ report: { status: string } }>().report.status, "pending");

  const read = await app.inject({ url: `${BASE}/matches/wfc-000123`, headers: TEST_AUTH });
  assert.equal(read.statusCode, 200);
  assert.equal(read.json<{ report: { status: string } }>().report.status, "test");
  await app.close();
});

test("a report must be JSON and valid; a match id is looked up in the key's own environment", async () => {
  const app = await createRechargedApp();
  const text = await app.inject({
    method: "POST",
    url: `${BASE}/matches`,
    headers: { ...TEST_AUTH, "content-type": "text/plain" },
    payload: JSON.stringify(REPORT),
  });
  assert.equal(text.statusCode, 415);
  assert.equal(text.json<{ code: string }>().code, "UNSUPPORTED_MEDIA_TYPE");

  const draw = await app.inject({
    method: "POST",
    url: `${BASE}/matches`,
    headers: TEST_AUTH,
    payload: { ...REPORT, player2: { discord_id: BOB, score: 2 } },
  });
  assert.equal(draw.statusCode, 400);
  assert.deepEqual(draw.json(), { error: "A rated match has a winner: the scores must differ.", code: "BAD_REQUEST" });

  await app.inject({ method: "POST", url: `${BASE}/matches`, headers: LIVE_AUTH, payload: REPORT });
  const otherEnvironment = await app.inject({ url: `${BASE}/matches/wfc-000123`, headers: TEST_AUTH });
  assert.equal(otherEnvironment.statusCode, 404);
  assert.deepEqual(otherEnvironment.json(), { error: "No report with this match_id.", code: "MATCH_NOT_FOUND" });

  const invalid = await app.inject({ url: `${BASE}/matches/${encodeURIComponent("-bad id")}`, headers: TEST_AUTH });
  assert.equal(invalid.statusCode, 400);
  await app.close();
});

test("limits count per key once rate limiting is on", async () => {
  const app = await createRechargedApp({ ...KEYS_ENV, RATE_LIMIT_ENABLED: "true" });
  const players = await app.inject({ url: `${BASE}/players/${ALICE}`, headers: TEST_AUTH });
  assert.equal(players.statusCode, 200);
  assert.equal(players.headers["x-ratelimit-limit"], "600");
  const ranks = await app.inject({ url: `${BASE}/ranks`, headers: TEST_AUTH });
  assert.equal(ranks.headers["x-ratelimit-limit"], "60");
  await app.close();
});

test("the fixtures answer with their own players and ladder", async () => {
  const { app } = await createTestApp({ env: KEYS_ENV });
  const player = await app.inject({ url: `${BASE}/players/900000000000000001`, headers: TEST_AUTH });
  assert.equal(player.statusCode, 200);
  const msc = player.json<{ player: { msc_1v1: { season: { name: string }; placement: { complete: boolean } } } }>()
    .player.msc_1v1;
  assert.equal(msc.season.name, "Dusk Season 2026");
  assert.equal(msc.placement.complete, true);
  const ranks = await app.inject({ url: `${BASE}/ranks`, headers: TEST_AUTH });
  assert.equal(ranks.json<{ ranks: unknown[] }>().ranks.length, 20);
  await app.close();
});
