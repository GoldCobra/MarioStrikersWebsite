import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError } from "../../http/errors.ts";
import { createFakeDatabase } from "../../test-support/fake-database.ts";
import { assertGameAndMode, parseLimit, parseOffset } from "./params.ts";
import type { WhrLeaderboardRecord } from "./repository.ts";
import { getLeaderboardRows } from "./service.ts";

const LIMITS = { defaultLimit: 100, maxLimit: 500 };

function whrRecord(overrides: Partial<WhrLeaderboardRecord> = {}): WhrLeaderboardRecord {
  return {
    player_id: 441,
    discord_user_id: "709777875686916210",
    display_name: "Legacy Player",
    rating: 1500,
    total_wins: 7,
    total_losses: 3,
    total_draws: 1,
    ...overrides,
  };
}

test("elo1v1 reads the active CompetitiveLeaderboard instead of the legacy rating procedure", async () => {
  const database = createFakeDatabase(({ text }) => {
    assert.match(text, /FROM rocci121_toby\.CompetitiveLeaderboard lb/);
    assert.doesNotMatch(text, /GetRatingsForDiscord/);
    return [
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
    ];
  });

  const rows = await getLeaderboardRows(
    database,
    { gameCode: "msc", modeCode: "elo1v1", limit: 10, offset: 0 },
    LIMITS,
  );

  assert.equal(database.statements.length, 1);
  const [statement] = database.statements;
  assert.ok(statement);
  assert.deepEqual(statement.values, [1, "1v1", 0, 10], "game type, mode, offset, limit");
  assert.match(statement.text, /INNER JOIN rocci121_toby\.CompetitiveSeason season ON season\.Id = lb\.SeasonId/);
  assert.match(statement.text, /season\.LifecycleStatus = 'active'/);
  assert.match(statement.text, /lb\.Mode = @p1/);
  assert.match(statement.text, /ISNULL\(lb\.RankNumber, 0\) > 0/);
  assert.match(statement.text, /OFFSET @p2 ROWS FETCH NEXT @p3 ROWS ONLY/);
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
  const database = createFakeDatabase(() => []);
  await getLeaderboardRows(database, { gameCode: "msbl", modeCode: "elo2v2", limit: 25, offset: 5 }, LIMITS);
  assert.equal(database.statements.length, 1);
  assert.deepEqual(database.statements[0]?.values, [3, "2v2", 5, 25]);
});

test("whr reads PlayerStats and Player in one query instead of the legacy rating procedure", async () => {
  const database = createFakeDatabase(({ text }) => {
    assert.doesNotMatch(text, /GetRatingsForDiscord|CompetitiveLeaderboard/);
    return [
      whrRecord({ display_name: " Legacy Player ", discord_user_id: " 709777875686916210 " }),
      whrRecord({ player_id: 9, display_name: "   ", rating: 1800 }),
    ];
  });

  const rows = await getLeaderboardRows(database, { gameCode: "sms", modeCode: "whr", limit: 10, offset: 0 }, LIMITS);

  assert.equal(database.statements.length, 1);
  const [statement] = database.statements;
  assert.ok(statement);
  assert.match(statement.text, /FROM dbo\.PlayerStats ps\s+INNER JOIN dbo\.Player p ON p\.ID = ps\.Player/);
  assert.match(statement.text, /CAST\(ROUND\(ps\.RatingWHR, 0, 0\) AS INT\) \+ 1000 AS rating/);
  assert.match(
    statement.text,
    /ps\.GameType = @p0\s+AND ps\.IsActive = 1\s+AND ps\.MatchWins \+ ps\.MatchLosses >= 10/,
  );
  assert.match(
    statement.text,
    /EXISTS \(\s*SELECT 1\s+FROM dbo\.Match m\s+WHERE m\.GameType = ps\.GameType\s+AND \(m\.Player1 = p\.ID OR m\.Player2 = p\.ID\)/,
  );
  assert.deepEqual(statement.values, [2], "SMS lists every WHR player");
  assert.doesNotMatch(statement.text, /MatchDate/);

  assert.equal(rows.length, 1, "a player without a name is not listed");
  const [row] = rows;
  assert.ok(row);
  const { updated_at: updatedAt, ...listed } = row;
  assert.deepEqual(listed, {
    rank: 1,
    player_id: 441,
    discord_user_id: "709777875686916210",
    display_name: "Legacy Player",
    total_matches: 11,
    total_wins: 7,
    total_losses: 3,
    total_draws: 1,
    total_game_diff: 0,
    total_goals_for: 0,
    total_goals_against: 0,
    total_goal_diff: 0,
    rating: 1500,
    competitive_rank: "",
  });
  assert.ok(Math.abs(Date.parse(updatedAt) - Date.now()) < 60_000, "updated now");
});

test("a long name keeps its player id and record: WHR rows are keyed by player id, not by name", async () => {
  // The procedure cut names to 22 characters, so a longer one never matched its Player row.
  const longName = "The Unbelievably Long Striker Name";
  const database = createFakeDatabase(() => [
    whrRecord({ player_id: 512, display_name: longName, discord_user_id: "", total_wins: 40, total_losses: 12 }),
  ]);

  const [row] = await getLeaderboardRows(database, { gameCode: "msc", modeCode: "whr" }, LIMITS);

  assert.equal(row?.player_id, 512);
  assert.equal(row.display_name, longName);
  assert.equal(row.total_matches, 53);
  assert.equal(row.discord_user_id, null, "an empty Discord id is null");
});

test("the MSBL WHR ladder only lists players active in the last 90 days; MSC and SMS list everyone", async () => {
  const database = createFakeDatabase(() => []);
  await getLeaderboardRows(database, { gameCode: "msbl", modeCode: "whr" }, LIMITS);
  await getLeaderboardRows(database, { gameCode: "msc", modeCode: "whr" }, LIMITS);

  const [msbl, msc] = database.statements;
  assert.ok(msbl);
  assert.match(msbl.text, /AND m\.MatchDate >= @p1\s/);
  const [gameType, since] = msbl.values;
  assert.equal(gameType, 3);
  assert.ok(since instanceof Date);
  const days = (Date.now() - since.getTime()) / 86_400_000;
  assert.ok(days > 89 && days < 91, `${days} days`);
  assert.deepEqual(msc?.values, [1]);
  assert.doesNotMatch(msc.text, /MatchDate/);
});

test("a WHR ladder of any size is one query, sorted by rating then name and paged here", async () => {
  // More players than SQL Server's 2100 parameters, worst first; every two share a rating, so the name decides.
  const records = Array.from({ length: 2100 }, (_, index) =>
    whrRecord({
      player_id: index + 1,
      display_name: `Player ${String(2099 - index).padStart(4, "0")}`,
      rating: 1000 + Math.floor(index / 2),
    }),
  );
  const database = createFakeDatabase(() => records);

  const rows = await getLeaderboardRows(database, { gameCode: "msc", modeCode: "whr", limit: 3, offset: 2 }, LIMITS);

  assert.equal(database.statements.length, 1);
  const [statement] = database.statements;
  assert.ok(statement);
  assert.equal(statement.values.length, 1);
  assert.doesNotMatch(statement.text, /OFFSET/, "the whole ladder is read and paged here");
  assert.deepEqual(
    rows.map((row) => [row.rank, row.display_name, row.rating]),
    [
      [3, "Player 0002", 2048],
      [4, "Player 0003", 2048],
      [5, "Player 0004", 2047],
    ],
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
