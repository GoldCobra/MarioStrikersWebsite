import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError } from "../../http/errors.ts";
import { createFakeDatabase } from "../../test-support/fake-database.ts";
import { assertGameAndMode, parseLimit, parseOffset } from "./params.ts";
import { NAME_CHUNK_SIZE } from "./repository.ts";
import { getLeaderboardRows, parseRatingLine } from "./service.ts";
import { RANK_ORDER, normalizeCompetitiveRank } from "./whr-ranks.ts";

const LIMITS = { defaultLimit: 100, maxLimit: 500 };

test("elo1v1 reads the active CompetitiveLeaderboard instead of the legacy rating procedure", async () => {
  const database = createFakeDatabase((sql) => {
    assert.match(sql, /CompetitiveLeaderboard/);
    assert.doesNotMatch(sql, /GetRatingsForDiscord/);
    return {
      recordset: [
        {
          rank: 1,
          player_id: 398,
          discord_user_id: "650333745232216077",
          display_name: "BKXO",
          total_matches: 1,
          total_wins: 1,
          total_losses: 0,
          rating: 598.9957,
          rank_number: 0,
          competitive_rank: "Unranked",
          updated_at: new Date("2026-06-03T22:00:00.000Z"),
        },
        {
          rank: 2,
          player_id: 223,
          discord_user_id: "709777875686916210",
          display_name: "Ranked Player",
          total_matches: 4,
          total_wins: 3,
          total_losses: 1,
          rating: 712,
          rank_number: 1,
          competitive_rank: "Bronze I",
          updated_at: new Date("2026-06-03T22:01:00.000Z"),
        },
      ],
    };
  });

  const rows = await getLeaderboardRows(
    database,
    { gameCode: "msc", modeCode: "elo1v1", limit: 10, offset: 0 },
    LIMITS,
  );

  assert.equal(database.queries.length, 1);
  const query = database.queries[0];
  assert.equal(query?.inputs.gametype, 1);
  assert.equal(query.inputs.mode, "1v1");
  assert.equal(query.inputs.limit, 10);
  assert.equal(query.inputs.offset, 0);
  assert.match(query.sql, /season\.LifecycleStatus = 'active'/);
  assert.match(query.sql, /ISNULL\(lb\.RankNumber, 0\) > 0/);
  assert.deepEqual(rows, [
    {
      rank: 1,
      player_id: 223,
      discord_user_id: "709777875686916210",
      display_name: "Ranked Player",
      total_matches: 4,
      total_wins: 3,
      total_losses: 1,
      total_draws: 0,
      total_game_diff: 0,
      total_goals_for: 0,
      total_goals_against: 0,
      total_goal_diff: 0,
      rating: 712,
      competitive_rank: "Bronze I",
      updated_at: "2026-06-03T22:01:00.000Z",
    },
  ]);
});

test("elo2v2 maps to the CompetitiveLeaderboard 2v2 mode", async () => {
  const database = createFakeDatabase(() => ({ recordset: [] }));
  await getLeaderboardRows(database, { gameCode: "msbl", modeCode: "elo2v2", limit: 25, offset: 5 }, LIMITS);
  assert.equal(database.queries.length, 1);
  assert.equal(database.queries[0]?.inputs.gametype, 3);
  assert.equal(database.queries[0].inputs.mode, "2v2");
  assert.equal(database.queries[0].inputs.offset, 5);
});

test("whr remains on the legacy rating procedure", async () => {
  const database = createFakeDatabase((sql) => {
    if (sql.includes("GetRatingsForDiscord")) return { recordset: [{ line: "<:rookie:123>`Legacy Player 1500`" }] };
    if (sql.includes("FROM PlayerStats")) {
      return { recordset: [{ name: "Legacy Player", total_wins: 7, total_losses: 3, total_draws: 1 }] };
    }
    if (sql.includes("FROM Player p")) {
      return { recordset: [{ name: "Legacy Player", player_id: 441, discord_user_id: "709777875686916210" }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  const rows = await getLeaderboardRows(database, { gameCode: "sms", modeCode: "whr", limit: 10, offset: 0 }, LIMITS);

  const first = database.queries[0];
  assert.match(first?.sql ?? "", /GetRatingsForDiscord/);
  assert.doesNotMatch(first?.sql ?? "", /CompetitiveLeaderboard/);
  assert.equal(first?.inputs.gametype, 2);
  assert.equal(first.inputs.doubles, 0);
  assert.equal(first.inputs.isWhr, 2);
  assert.equal(first.inputs.playedGameWithinDate, undefined, "SMS lists every WHR player");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.player_id, 441);
  assert.equal(rows[0].display_name, "Legacy Player");
  assert.equal(rows[0].rating, 1500);
  assert.equal(rows[0].total_matches, 11);
  assert.equal(rows[0].competitive_rank, "Rookie");
});

test("the MSBL WHR ladder only lists players active in the last 90 days", async () => {
  const database = createFakeDatabase(() => ({ recordset: [] }));
  await getLeaderboardRows(database, { gameCode: "msbl", modeCode: "whr" }, LIMITS);
  const since = database.queries[0]?.inputs.playedGameWithinDate;
  assert.ok(since instanceof Date);
  const days = (Date.now() - since.getTime()) / 86_400_000;
  assert.ok(days > 89 && days < 91, `${days} days`);
});

test("large WHR name lists stay below SQL Server's parameter limit", async () => {
  const lines = Array.from({ length: 2100 }, (_, index) => ({
    line: `<:rookie:1>\`Player ${index} ${2000 - index}\``,
  }));
  const database = createFakeDatabase((sql) =>
    sql.includes("GetRatingsForDiscord") ? { recordset: lines } : { recordset: [] },
  );
  const rows = await getLeaderboardRows(database, { gameCode: "msc", modeCode: "whr", limit: 5 }, LIMITS);
  const nameQueries = database.queries.slice(1);
  assert.ok(nameQueries.length >= 6, "records and identities are each queried in chunks");
  for (const query of nameQueries) assert.ok(Object.keys(query.inputs).length <= NAME_CHUNK_SIZE + 1);
  assert.deepEqual(
    rows.map((row) => row.display_name),
    ["Player 0", "Player 1", "Player 2", "Player 3", "Player 4"],
  );
});

test("game and mode are validated with the public error messages", () => {
  assert.deepEqual(assertGameAndMode(" MSBL ", "ELO1V1"), { game: "msbl", mode: "elo1v1" });
  assert.throws(
    () => assertGameAndMode("invalid", "elo1v1"),
    (error: unknown) =>
      error instanceof HttpError && error.statusCode === 400 && error.message === "Invalid game code.",
  );
  assert.throws(() => assertGameAndMode("msbl", "invalid"), /Invalid leaderboard mode\./);
  assert.throws(() => assertGameAndMode("constructor", "elo1v1"), /Invalid game code\./);
});

test("limits and offsets fall back instead of failing", () => {
  assert.equal(parseLimit("abc", 100, 500), 100);
  assert.equal(parseLimit("0", 100, 500), 100);
  assert.equal(parseLimit("12.7", 100, 500), 12);
  assert.equal(parseLimit("9999", 100, 500), 500);
  assert.equal(parseOffset("-1"), 0);
  assert.equal(parseOffset("3.9"), 3);
});

test("rating lines parse names, ratings and legacy rank emoji", () => {
  assert.deepEqual(parseRatingLine("<:megastriker:1>`Some Name 2130`"), {
    displayName: "Some Name",
    rating: 2130,
    competitiveRank: "Megastriker",
  });
  assert.deepEqual(parseRatingLine("<:blball:1>`Name -12.5`"), {
    displayName: "Name",
    rating: -12.5,
    competitiveRank: "blball",
  });
  assert.equal(parseRatingLine("no backticks"), null);
  assert.equal(parseRatingLine("`1500`"), null);
});

test("RANK_ORDER is the five sequential community tiers", () => {
  assert.deepEqual(
    RANK_ORDER.map((rank) => rank.code),
    ["rookie", "professional", "superstar", "legend", "megastriker"],
  );
});

test("legacy rank codes map case- and punctuation-insensitively", () => {
  assert.equal(normalizeCompetitiveRank("1")?.code, "rookie");
  assert.equal(normalizeCompetitiveRank("3")?.code, "superstar");
  assert.equal(normalizeCompetitiveRank("5")?.name, "Megastriker");
  assert.equal(normalizeCompetitiveRank("Superstar")?.code, "superstar");
  assert.equal(normalizeCompetitiveRank("MEGA-STRIKER")?.code, "megastriker");
  assert.equal(normalizeCompetitiveRank("mega")?.code, "megastriker");
  assert.equal(normalizeCompetitiveRank(""), null);
  assert.equal(normalizeCompetitiveRank(null), null);
  assert.equal(normalizeCompetitiveRank("diamond"), null);
  assert.equal(normalizeCompetitiveRank("6"), null);
});
