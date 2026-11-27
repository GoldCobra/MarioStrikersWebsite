import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDatabase } from "../../test-support/fake-database.ts";
import { createSqlRechargedStore } from "./repository.ts";
import type { MatchReport } from "./service.ts";

/** A statement's text on one line, as the assertions read it. */
const flat = (text = ""): string => text.replace(/\s+/g, " ").trim();

const ALICE = "195905866527014912";
const BOB = "329703291980087296";
const PLAYED_AT = new Date("2026-11-27T17:54:11.000Z");
const RECEIVED_AT = new Date("2026-11-27T18:00:00.123Z");

const REPORT: MatchReport = {
  environment: "test",
  matchId: "wfc-000123",
  playedAt: PLAYED_AT,
  player1: { discordId: ALICE, score: 2 },
  player2: { discordId: BOB, score: 1 },
};

const STORED_ROW = {
  environment: "test",
  match_id: "wfc-000123",
  played_at: PLAYED_AT,
  player1_discord_id: ALICE,
  player1_score: 2,
  player2_discord_id: BOB,
  player2_score: 1,
  status: "test",
  received_at: RECEIVED_AT,
  processed_at: null,
};

const STORED = {
  ...REPORT,
  status: "test",
  receivedAt: RECEIVED_AT,
  processedAt: null,
};

function duplicateKeyError(): Error {
  return Object.assign(
    new Error("Violation of UNIQUE KEY constraint 'UQ_ExternalMatchReport_Match'. Cannot insert duplicate key."),
    { number: 2627 },
  );
}

test("a player is read in one batch: the player, the active season, the MSC 1v1 rating and rank 0", async () => {
  const db = createFakeDatabase(() => ({
    sets: [
      [{ player_id: 223, name: "GoldCobra", hide_stats: false }],
      [{ season_id: 3, season_name: "Dusk Season 2026", ends_at: new Date("2026-12-02T08:00:00.000Z") }],
      [
        {
          elo: 812.4567,
          rank_number: 5,
          rank_name: "Silver II",
          placement_played: 5,
          placement_complete: true,
          wins: 12,
          losses: 7,
        },
      ],
      [{ elo: 500, name: "Unranked" }],
    ],
  }));
  assert.deepEqual(await createSqlRechargedStore(db).findPlayer(ALICE), {
    playerId: 223,
    name: "GoldCobra",
    hideStats: false,
    season: { id: 3, name: "Dusk Season 2026", endsAt: new Date("2026-12-02T08:00:00.000Z") },
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
  });
  assert.equal(db.statements.length, 1);
  const [statement] = db.statements;
  assert.deepEqual(statement?.values, [ALICE]);
  const text = flat(statement.text);
  assert.match(text, /DECLARE @playerId INT = \(SELECT TOP 1 ID FROM dbo\.Player WHERE DiscordID = @p0 ORDER BY ID\);/);
  // Only HideStats = 0 shows statistics, as on the profile; anything else, NULL included, is hidden.
  assert.match(text, /CAST\(CASE WHEN p\.HideStats = 0 THEN 0 ELSE 1 END AS BIT\) AS hide_stats/);
  assert.match(text, /rating\.PlayerId = @playerId AND rating\.GameId = 1 AND rating\.ModeCode = '1v1'/);
  assert.equal(text.match(/season\.IsActive = 1 AND season\.LifecycleStatus = 'active'/g)?.length, 2);
  assert.match(text, /WHERE threshold\.IsActive = 1 AND threshold\.RankNumber = 0;$/);
});

test("an unknown Discord account is null; without an active season there is no rating", async () => {
  const unknown = createFakeDatabase(() => ({ sets: [[], [], [], [{ elo: 500, name: "Unranked" }]] }));
  assert.equal(await createSqlRechargedStore(unknown).findPlayer(BOB), null);

  const between = createFakeDatabase(() => ({
    sets: [[{ player_id: 7, name: "Hidden", hide_stats: true }], [], [], []],
  }));
  assert.deepEqual(await createSqlRechargedStore(between).findPlayer(BOB), {
    playerId: 7,
    name: "Hidden",
    hideStats: true,
    season: null,
    rating: null,
    unranked: null,
  });
});

test("the active ranks are read in order", async () => {
  const db = createFakeDatabase(() => [
    { rank_number: 0, name: "Unranked", tier: "Unranked", min_elo: 500 },
    { rank_number: 1, name: "Bronze I", tier: "Bronze", min_elo: 500 },
  ]);
  assert.deepEqual(await createSqlRechargedStore(db).listRanks(), [
    { rankNumber: 0, name: "Unranked", tier: "Unranked", minElo: 500 },
    { rankNumber: 1, name: "Bronze I", tier: "Bronze", minElo: 500 },
  ]);
  assert.match(
    flat(db.statements[0]?.text),
    /FROM rocci121_toby\.CompetitiveRankThreshold WHERE IsActive = 1 ORDER BY RankNumber;$/,
  );
});

test("a report is stored in one locked batch and answered with the stored row", async () => {
  const db = createFakeDatabase(() => [{ created: true, ...STORED_ROW }]);
  assert.deepEqual(await createSqlRechargedStore(db).saveReport(REPORT, "test"), { created: true, report: STORED });
  assert.equal(db.statements.length, 1);
  const [statement] = db.statements;
  const text = flat(statement?.text);
  assert.match(text, /^BEGIN TRANSACTION;/);
  assert.match(
    text,
    /IF NOT EXISTS \( SELECT 1 FROM rocci121_toby\.ExternalMatchReport WITH \(UPDLOCK, HOLDLOCK\) WHERE Source = 'recharged' AND Environment = @environment AND ExternalMatchId = @matchId \)/,
  );
  assert.match(
    text,
    /VALUES \('recharged', @environment, @matchId, 1, '1v1', @p2, @p3, @p4, @p5, @p6, @p7\); SET @created = 1; END; COMMIT TRANSACTION;/,
  );
  assert.deepEqual(statement?.values, ["test", "wfc-000123", ALICE, 2, BOB, 1, PLAYED_AT, "test"]);

  const repeated = createFakeDatabase(() => [{ created: false, ...STORED_ROW }]);
  assert.equal((await createSqlRechargedStore(repeated).saveReport(REPORT, "test")).created, false);
});

test("a parallel delivery that loses the race reads the stored report", async () => {
  let calls = 0;
  const db = createFakeDatabase(() => {
    calls += 1;
    if (calls === 1) throw duplicateKeyError();
    return [STORED_ROW];
  });
  assert.deepEqual(await createSqlRechargedStore(db).saveReport(REPORT, "test"), { created: false, report: STORED });
  assert.equal(db.statements.length, 2);
  assert.deepEqual(db.statements[1]?.values, ["test", "wfc-000123"]);

  const vanished = createFakeDatabase((statement) => {
    if (statement.text.includes("BEGIN TRANSACTION")) throw duplicateKeyError();
    return [];
  });
  await assert.rejects(createSqlRechargedStore(vanished).saveReport(REPORT, "test"), /UQ_ExternalMatchReport_Match/);

  const failing = createFakeDatabase(() => {
    throw new Error("Connection is closed.");
  });
  await assert.rejects(createSqlRechargedStore(failing).saveReport(REPORT, "test"), /Connection is closed/);
  assert.equal(failing.statements.length, 1);
});

test("a report is found by its key environment and match id; a stored value the API never writes is an error", async () => {
  const db = createFakeDatabase(() => [{ ...STORED_ROW, environment: "live", status: "pending" }]);
  const found = await createSqlRechargedStore(db).findReport("live", "wfc-000123");
  assert.equal(found?.status, "pending");
  assert.equal(found.environment, "live");
  assert.deepEqual(db.statements[0]?.values, ["live", "wfc-000123"]);
  assert.match(
    flat(db.statements[0].text),
    /WHERE Source = 'recharged' AND Environment = @p0 AND ExternalMatchId = @p1;$/,
  );

  assert.equal(await createSqlRechargedStore(createFakeDatabase(() => [])).findReport("test", "x"), null);
  const odd = createFakeDatabase(() => [{ ...STORED_ROW, status: "lost" }]);
  await assert.rejects(createSqlRechargedStore(odd).findReport("test", "wfc-000123"), /unknown status/);
  const oddEnvironment = createFakeDatabase(() => [{ ...STORED_ROW, environment: "prod" }]);
  await assert.rejects(createSqlRechargedStore(oddEnvironment).findReport("test", "wfc-000123"), /unknown environment/);
});
