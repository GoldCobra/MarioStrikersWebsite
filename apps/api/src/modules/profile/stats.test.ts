import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDatabase } from "../../test-support/fake-database.ts";
import { buildProfileStatsQuery, getProfileStatsByDiscordId } from "./stats-repository.ts";
import { PROFILE_STATS_SETS, buildProfileStats, toProfileStatsResponse, winPercent, type GameStats } from "./stats.ts";

type Row = Record<string, unknown>;

/** The batch's result sets, by name. */
function sets(parts: Partial<Record<keyof typeof PROFILE_STATS_SETS, Row[]>>): Row[][] {
  const all: Row[][] = [[], [], [], [], [], []];
  for (const [name, rows] of Object.entries(parts))
    all[PROFILE_STATS_SETS[name as keyof typeof PROFILE_STATS_SETS]] = rows;
  return all;
}

const SEASON = [{ Id: 3, DisplayName: "Dusk Season 2026" }];
const game = (stats: ReturnType<typeof buildProfileStats>, code: string): GameStats => {
  const found = stats.games.find((entry) => entry.game === code);
  assert.ok(found, code);
  return found;
};

test("a player with every value: one area per game, MSBL, MSC, SMS, each value from its source", () => {
  const stats = buildProfileStats(
    sets({
      season: SEASON,
      seasonRatings: [{ GameId: 3, Elo: 1187.5, RankNumber: 9, RankName: "Gold III", MatchWins: 14, MatchLosses: 6 }],
      highestRanks: [{ GameId: 3, RankNumber: 11, RankName: "Platinum II" }],
      playerStats: [{ GameType: 3, Whr: 1612, MatchWins: 212, MatchLosses: 131 }],
      whrHistory: [{ GameType: 3, MaxWhr: 1688, Days: 120 }],
      legacyRanks: [{ GameType: 3, Rank: 13, Rank2v2: 4, Singles: 64, Teams: 9 }],
    }),
  );
  assert.equal(stats.season, "Dusk Season 2026");
  assert.deepEqual(
    stats.games.map((entry) => entry.game),
    ["MSBL", "MSC", "SMS"],
  );
  assert.deepEqual(game(stats, "MSBL"), {
    game: "MSBL",
    seasonRank: "Gold III",
    seasonElo: 1188,
    seasonWins: 14,
    seasonLosses: 6,
    highestSeasonRank: "Platinum II",
    currentWhr: 1612,
    highestWhr: 1688,
    totalWins: 212,
    totalLosses: 131,
    totalMatches: 343,
    totalWinPercent: 61.8,
    highestLegacyRank: "Megastriker",
  });
});

test("games are kept apart: a player who played one game has '-' (null) everywhere else", () => {
  const stats = buildProfileStats(
    sets({
      season: SEASON,
      seasonRatings: [{ GameId: 1, Elo: 845.99, RankNumber: 5, RankName: "Silver II", MatchWins: 13, MatchLosses: 0 }],
      highestRanks: [{ GameId: 1, RankNumber: 5, RankName: "Silver II" }],
      playerStats: [{ GameType: 1, Whr: 1830, MatchWins: 324, MatchLosses: 80 }],
      whrHistory: [{ GameType: 1, MaxWhr: 1875, Days: 226 }],
    }),
  );
  assert.equal(game(stats, "MSC").seasonElo, 846);
  for (const code of ["MSBL", "SMS"]) {
    const { game: name, ...values } = game(stats, code);
    assert.equal(name, code);
    assert.ok(
      Object.values(values).every((value) => value === null),
      code,
    );
  }
});

test("never rated: '-' in every field of every game, even with an empty 0-0 PlayerStats row", () => {
  // GoldCobra (live, 2026-10-03): 0-0 rows for MSC (1) and MSBL (3) - MSBL from a 2v2 match - none for SMS,
  // no rated 1v1 match anywhere (owner: 0-0 and 0 only once really rated).
  const stats = buildProfileStats(
    sets({
      season: SEASON,
      playerStats: [
        { GameType: 1, Whr: 1000, MatchWins: 0, MatchLosses: 0 },
        { GameType: 3, Whr: 1000, MatchWins: 0, MatchLosses: 0 },
      ],
    }),
  );
  for (const { game: name, ...values } of stats.games) {
    assert.ok(
      Object.values(values).every((value) => value === null),
      name,
    );
  }
});

test("no current season: the season values are missing, never taken from an earlier season", () => {
  const stats = buildProfileStats(
    sets({
      // Between seasons the active-season sets are empty; a stray rating row must not count.
      seasonRatings: [{ GameId: 3, Elo: 900, RankNumber: 6, RankName: "Silver III", MatchWins: 3, MatchLosses: 1 }],
      highestRanks: [{ GameId: 3, RankNumber: 6, RankName: "Silver III" }],
    }),
  );
  const msbl = game(stats, "MSBL");
  assert.equal(stats.season, "");
  assert.deepEqual([msbl.seasonRank, msbl.seasonElo, msbl.seasonWins, msbl.seasonLosses], [null, null, null, null]);
  assert.equal(msbl.highestSeasonRank, "Silver III", "the history stays");
});

test("a rated player's real zeros stay zeros; without a match the win rate is undefined", () => {
  // A season row carried over at the rollover: rated in an earlier season, nothing played in this one.
  const stats = buildProfileStats(
    sets({
      season: SEASON,
      seasonRatings: [{ GameId: 2, Elo: 500, RankNumber: 0, RankName: "Unranked", MatchWins: 0, MatchLosses: 0 }],
      highestRanks: [{ GameId: 2, RankNumber: 3, RankName: "Bronze III" }],
      playerStats: [{ GameType: 2, Whr: 1043, MatchWins: 9, MatchLosses: 12 }],
      whrHistory: [{ GameType: 2, MaxWhr: 1101, Days: 14 }],
    }),
  );
  const sms = game(stats, "SMS");
  assert.deepEqual(
    [sms.seasonRank, sms.seasonElo, sms.seasonWins, sms.seasonLosses, sms.highestSeasonRank],
    ["Unranked", 500, 0, 0, "Bronze III"],
  );
  assert.deepEqual([sms.totalWins, sms.totalLosses, sms.totalMatches, sms.totalWinPercent], [9, 12, 21, 42.9]);
  // Rated (here only a recorded season rank) with an empty record: 0-0, 0 matches and no win rate.
  const msc = game(
    buildProfileStats(
      sets({
        highestRanks: [{ GameId: 1, RankNumber: 0, RankName: "Unranked" }],
        playerStats: [{ GameType: 1, Whr: 1000, MatchWins: 0, MatchLosses: 0 }],
      }),
    ),
    "MSC",
  );
  assert.deepEqual([msc.totalWins, msc.totalLosses, msc.totalMatches, msc.totalWinPercent], [0, 0, 0, null]);
  // A WHR without any rated day is no WHR: PlayerStats keeps 0 (shown 1000) for everyone.
  assert.deepEqual([msc.currentWhr, msc.highestWhr], [null, null]);
});

test("incomplete history: only what is recorded, nothing derived from current values", () => {
  const stats = buildProfileStats(
    sets({
      season: SEASON,
      playerStats: [{ GameType: 1, Whr: 1131, MatchWins: 9, MatchLosses: null }],
      whrHistory: [{ GameType: 1, MaxWhr: 1565, Days: 30 }],
      legacyRanks: [
        // 1v1 Legend without its 10 legacy matches does not count; 2v2 Professional with 4 does.
        { GameType: 1, Rank: 10, Rank2v2: 5, Singles: 4, Teams: 4 },
        // A rank that needed matches it never had: nothing.
        { GameType: 3, Rank: 13, Rank2v2: 0, Singles: 9, Teams: 0 },
      ],
    }),
  );
  const msc = game(stats, "MSC");
  assert.equal(msc.highestSeasonRank, null, "no rank history, no highest rank");
  assert.deepEqual([msc.currentWhr, msc.highestWhr], [1131, 1565]);
  assert.deepEqual([msc.totalWins, msc.totalLosses, msc.totalMatches, msc.totalWinPercent], [null, null, null, null]);
  assert.equal(msc.highestLegacyRank, "Professional");
  assert.equal(game(stats, "MSBL").highestLegacyRank, null);
});

test("the highest legacy rank follows ROOKIE < PROFESSIONAL < SUPERSTAR < LEGEND < MEGASTRIKER", () => {
  const legacy = (rank: number) =>
    game(
      buildProfileStats(sets({ legacyRanks: [{ GameType: 2, Rank: rank, Rank2v2: 0, Singles: 50, Teams: 0 }] })),
      "SMS",
    ).highestLegacyRank;
  assert.deepEqual([1, 3, 4, 7, 10, 12, 13].map(legacy), [
    "Rookie",
    "Rookie",
    "Professional",
    "Superstar",
    "Legend",
    "Legend",
    "Megastriker",
  ]);
  assert.equal(legacy(0), null);
});

test("win rate: W / (W + L) × 100 rounded half up to one decimal", () => {
  assert.equal(winPercent(1, 2), 33.3);
  assert.equal(winPercent(2, 1), 66.7);
  assert.equal(winPercent(212, 131), 61.8);
  assert.equal(winPercent(324, 80), 80.2);
  assert.equal(winPercent(1, 15), 6.3, "6.25");
  assert.equal(winPercent(201, 199), 50.3, "50.25, which W / (W + L) × 1000 rounds down");
  assert.equal(winPercent(203, 197), 50.8, "50.75");
  assert.equal(winPercent(5, 0), 100);
  assert.equal(winPercent(0, 5), 0);
  assert.equal(winPercent(0, 0), null);
});

test("one batch for one player: the active season, 1v1, every rank source, the legacy rule's counts", () => {
  const sql = buildProfileStatsQuery();
  assert.equal(sql.match(/@playerId/g)?.length, 12);
  assert.doesNotMatch(sql, /@(?!playerId\b|cutoff\b)\w+/, "no other parameter");
  assert.match(sql, /s\.IsActive = 1 AND s\.LifecycleStatus = 'active'/);
  assert.equal(sql.match(/ModeCode = '1v1'/g)?.length, 6);
  for (const source of ["r.RankNumber", "r.PeakRankNumber", "c.RankAfter", "n.PeakRankNumber", "n.FinalRankNumber"]) {
    assert.ok(sql.includes(source), source);
  }
  assert.match(sql, /CAST\(ROUND\(ps\.RatingWHR \+ 1000, 0\) AS INT\) AS Whr/);
  assert.match(sql, /MAX\(h\.RatingWHR\) \+ 1000/);
  assert.match(sql, /m\.MatchDate < @cutoff/);
});

test("the player comes from the Discord account; an unlinked account reads nothing", async () => {
  const database = createFakeDatabase((sql, inputs) => {
    if (sql.includes("DiscordID")) {
      return {
        recordset:
          inputs.discordId === "195905866527014912"
            ? [{ player_id: 223, discord_id: "195905866527014912", name: "GoldCobra" }]
            : [],
      };
    }
    return {
      recordsets: sets({ season: SEASON, playerStats: [{ GameType: 3, Whr: null, MatchWins: 3, MatchLosses: 1 }] }),
    };
  });
  const stats = await getProfileStatsByDiscordId(database, "195905866527014912");
  assert.equal(stats?.games[0]?.totalMatches, 4);
  const batch = database.queries.find((query) => query.sql === buildProfileStatsQuery());
  assert.equal(batch?.inputs.playerId, 223);
  assert.equal(await getProfileStatsByDiscordId(database, "1"), null);
  assert.equal(database.queries.filter((query) => query.sql === buildProfileStatsQuery()).length, 1);
});

test("the response is snake_case and keeps null for '-'", () => {
  const response = toProfileStatsResponse(buildProfileStats(sets({})));
  assert.deepEqual(response.season, "");
  assert.deepEqual((response.games as Record<string, unknown>[])[2], {
    game: "SMS",
    season_rank: null,
    season_elo: null,
    season_wins: null,
    season_losses: null,
    highest_season_rank: null,
    current_whr: null,
    highest_whr: null,
    total_wins: null,
    total_losses: null,
    total_matches: null,
    total_win_percent: null,
    highest_legacy_rank: null,
  });
});
