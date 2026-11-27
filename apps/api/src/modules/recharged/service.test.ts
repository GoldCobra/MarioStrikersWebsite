import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../../http/errors.ts";
import {
  createMemoryRechargedStore,
  parseMatchReport,
  submitMatchReport,
  toPlayerResponse,
  toRanksResponse,
  toReportResponse,
  type RankRecord,
  type RechargedPlayerRecord,
} from "./service.ts";

const NOW = Date.parse("2026-11-27T18:00:00.000Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ALICE = "195905866527014912";
const BOB = "329703291980087296";

const VALID = {
  match_id: "wfc-2026-11-27:000123",
  played_at: "2026-11-27T17:54:11.875Z",
  player1: { discord_id: ALICE, score: 2 },
  player2: { discord_id: BOB, score: 1 },
};

const LADDER: readonly RankRecord[] = [
  { rankNumber: 0, name: "Unranked", tier: "Unranked", minElo: 500 },
  { rankNumber: 1, name: "Bronze I", tier: "Bronze", minElo: 500 },
  { rankNumber: 2, name: "Bronze II", tier: "Bronze", minElo: 570 },
];

const SEASON = { id: 3, name: "Dusk Season 2026", endsAt: new Date("2026-12-02T08:00:00.000Z") };

function player(overrides: Partial<RechargedPlayerRecord> = {}): RechargedPlayerRecord {
  return {
    playerId: 223,
    name: "GoldCobra",
    hideStats: false,
    season: SEASON,
    rating: {
      elo: 812.4567,
      rankNumber: 5,
      rankName: "Silver II",
      placementPlayed: 5,
      placementComplete: true,
      wins: 12,
      losses: 7,
    },
    unranked: { elo: 500, name: "Unranked" },
    ...overrides,
  };
}

function badRequestMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, "BAD_REQUEST");
    return error.message;
  }
  assert.fail("expected a 400");
}

test("a valid report is read with its time in whole UTC seconds", () => {
  const report = parseMatchReport(VALID, "test", NOW);
  assert.deepEqual(report, {
    environment: "test",
    matchId: "wfc-2026-11-27:000123",
    playedAt: new Date("2026-11-27T17:54:11.000Z"),
    player1: { discordId: ALICE, score: 2 },
    player2: { discordId: BOB, score: 1 },
  });
  const offset = parseMatchReport({ ...VALID, played_at: "2026-11-27T19:54:11+02:00" }, "live", NOW);
  assert.equal(offset.playedAt.toISOString(), "2026-11-27T17:54:11.000Z");
  assert.equal(offset.environment, "live");
});

test("played_at may lie up to 5 minutes ahead and up to 30 days back", () => {
  const at = (time: number): string => new Date(time).toISOString();
  assert.ok(parseMatchReport({ ...VALID, played_at: at(NOW + 5 * MINUTE) }, "test", NOW));
  assert.ok(parseMatchReport({ ...VALID, played_at: at(NOW - 30 * DAY) }, "test", NOW));
  assert.equal(
    badRequestMessage(() => parseMatchReport({ ...VALID, played_at: at(NOW + 5 * MINUTE + 1000) }, "test", NOW)),
    "played_at lies in the future.",
  );
  assert.equal(
    badRequestMessage(() => parseMatchReport({ ...VALID, played_at: at(NOW - 30 * DAY - 1000) }, "test", NOW)),
    "played_at is more than 30 days ago.",
  );
});

test("every rule of a report has its own message", () => {
  const cases: readonly [unknown, string][] = [
    [null, "Send the report as a JSON object."],
    [[VALID], "Send the report as a JSON object."],
    ["text", "Send the report as a JSON object."],
    ...["", "-starts-with-dash", "has space", "x".repeat(65), 12, "ümlaut"].map((matchId): [unknown, string] => [
      { ...VALID, match_id: matchId },
      "match_id must be 1 to 64 letters, digits or . _ : -, starting with a letter or digit.",
    ]),
    ...[
      "2026-11-27T17:54:11",
      "2026-11-27",
      "yesterday",
      "2026-02-30T10:00:00Z",
      "2026-02-29T10:00:00Z",
      "2026-11-27T24:00:00Z",
      "2026-11-27T17:60:11Z",
      "2026-11-27T17:54:11+24:00",
      "2026-11-27 17:54:11Z",
      1764266051000,
      null,
    ].map((playedAt): [unknown, string] => [
      { ...VALID, played_at: playedAt },
      "played_at must be an ISO 8601 time with its offset, e.g. 2026-11-27T18:04:11Z.",
    ]),
    ...[
      undefined,
      {},
      { discord_id: 195905866527014912 },
      { discord_id: "12345" },
      { discord_id: "1959x5866527014912" },
    ].map((side): [unknown, string] => [
      { ...VALID, player1: side },
      "player1.discord_id must be a Discord user id: 15 to 20 digits, sent as a string.",
    ]),
    ...[undefined, -1, 100, 1.5, "2"].map((score): [unknown, string] => [
      { ...VALID, player2: { discord_id: BOB, score } },
      "player2.score must be a whole number from 0 to 99.",
    ]),
    [{ ...VALID, player2: { discord_id: ALICE, score: 1 } }, "player1 and player2 must be different players."],
    [{ ...VALID, player2: { discord_id: BOB, score: 2 } }, "A rated match has a winner: the scores must differ."],
  ];
  for (const [body, message] of cases) {
    assert.equal(
      badRequestMessage(() => parseMatchReport(body, "test", NOW)),
      message,
      JSON.stringify(body),
    );
  }
  assert.ok(parseMatchReport({ ...VALID, match_id: "x".repeat(64) }, "test", NOW));
  assert.ok(parseMatchReport({ ...VALID, match_id: "A" }, "test", NOW));
  assert.ok(parseMatchReport({ ...VALID, player1: { discord_id: ALICE, score: 99 } }, "test", NOW));
});

test("a report is stored once: the same again is answered with it, other values with 409", async () => {
  const store = createMemoryRechargedStore({ players: () => null, ranks: LADDER, now: () => NOW });
  const first = await submitMatchReport(store, VALID, "test", NOW);
  assert.equal(first.created, true);
  assert.equal(first.report.status, "test");
  assert.equal(first.report.receivedAt.getTime(), NOW);

  const again = await submitMatchReport(store, { ...VALID, played_at: "2026-11-27T17:54:11.000Z" }, "test", NOW + 1000);
  assert.equal(again.created, false);
  assert.deepEqual(again.report, first.report);

  for (const changed of [
    { ...VALID, played_at: "2026-11-27T17:54:12Z" },
    { ...VALID, player1: { discord_id: ALICE, score: 3 } },
    { ...VALID, player1: VALID.player2, player2: VALID.player1 },
  ]) {
    await assert.rejects(submitMatchReport(store, changed, "test", NOW), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "MATCH_ID_CONFLICT");
      return true;
    });
  }

  const live = await submitMatchReport(store, VALID, "live", NOW);
  assert.equal(live.created, true, "test and live reports are apart");
  assert.equal(live.report.status, "pending");
  assert.equal((await store.findReport("test", VALID.match_id))?.status, "test");
  assert.equal(await store.findReport("test", "unknown"), null);
});

test("a player's MSC 1v1 rating of the season, and the profile's placement rule", () => {
  assert.deepEqual(toPlayerResponse(ALICE, player()), {
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
  const placing = player({
    rating: {
      elo: 640,
      rankNumber: 0,
      rankName: "Unranked",
      placementPlayed: 3,
      placementComplete: false,
      wins: 2,
      losses: 1,
    },
  });
  assert.deepEqual((toPlayerResponse(ALICE, placing).player as { msc_1v1: { placement: unknown } }).msc_1v1.placement, {
    played: 3,
    required: 5,
    complete: false,
  });
});

test("a player without a rating this season stands at rank 0, hidden statistics stay hidden", () => {
  const fresh = toPlayerResponse(BOB, player({ rating: null })).player as Record<string, unknown>;
  assert.deepEqual(fresh.msc_1v1, {
    season: { id: 3, name: "Dusk Season 2026", ends_at: "2026-12-02T08:00:00.000Z" },
    elo: 500,
    rank: { number: 0, name: "Unranked" },
    placement: { played: 0, required: 5, complete: false },
    wins: 0,
    losses: 0,
  });
  const hidden = toPlayerResponse(ALICE, player({ hideStats: true })).player as Record<string, unknown>;
  assert.equal(hidden.stats_hidden, true);
  assert.equal(hidden.msc_1v1, null);
  const between = toPlayerResponse(ALICE, player({ season: null })).player as Record<string, unknown>;
  assert.equal(between.stats_hidden, false);
  assert.equal(between.msc_1v1, null);
  assert.throws(() => toPlayerResponse(BOB, player({ rating: null, unranked: null })), /no active rank 0/);
});

test("the ladder, and a report, as the routes answer them", () => {
  assert.deepEqual(toRanksResponse(LADDER), {
    default_elo: 500,
    placement_matches: 5,
    ranks: [
      { number: 0, name: "Unranked", tier: "Unranked", min_elo: 500 },
      { number: 1, name: "Bronze I", tier: "Bronze", min_elo: 500 },
      { number: 2, name: "Bronze II", tier: "Bronze", min_elo: 570 },
    ],
  });
  assert.throws(() => toRanksResponse(LADDER.slice(1)), /no active rank 0/);

  const report = parseMatchReport(VALID, "test", NOW);
  assert.deepEqual(toReportResponse({ ...report, status: "test", receivedAt: new Date(NOW), processedAt: null }), {
    match_id: "wfc-2026-11-27:000123",
    environment: "test",
    status: "test",
    played_at: "2026-11-27T17:54:11.000Z",
    received_at: "2026-11-27T18:00:00.000Z",
    processed_at: null,
    player1: { discord_id: ALICE, score: 2 },
    player2: { discord_id: BOB, score: 1 },
  });
});

test("the memory store lists the ranks in order and finds players through its lookup", async () => {
  const store = createMemoryRechargedStore({
    players: (discordId) => (discordId === ALICE ? player() : null),
    ranks: [...LADDER].reverse(),
    now: () => NOW,
  });
  assert.deepEqual(
    (await store.listRanks()).map((rank) => rank.rankNumber),
    [0, 1, 2],
  );
  assert.equal((await store.findPlayer(ALICE))?.playerId, 223);
  assert.equal(await store.findPlayer(BOB), null);
});
