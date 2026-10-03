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
    totalWinPercent: 61.81,
    highestLegacyRank: "Megastriker",
  });
});

test("games are kept apart: a game never played has 0-0 and 0 matches, '-' (null) for everything else", () => {
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
    assert.deepEqual(game(stats, code), {
      game: code,
      seasonRank: null,
      seasonElo: null,
      seasonWins: 0,
      seasonLosses: 0,
      highestSeasonRank: null,
      currentWhr: null,
      highestWhr: null,
      totalWins: 0,
      totalLosses: 0,
      totalMatches: 0,
      totalWinPercent: null,
      highestLegacyRank: null,
    });
  }
});

test("nothing played looks the same in every game, with or without an empty PlayerStats row", () => {
  // GoldCobra (live, 2026-10-03): empty rows for MSC (1) and MSBL (3) - MSBL from a 2v2 match - none for SMS.
  const stats = buildProfileStats(
    sets({
      season: SEASON,
      playerStats: [
        { GameType: 1, Whr: 1000, MatchWins: 0, MatchLosses: 0 },
        { GameType: 3, Whr: 1000, MatchWins: 0, MatchLosses: 0 },
      ],
    }),
  );
  const [msbl, msc, sms] = stats.games;
  assert.deepEqual(msc, { ...msbl, game: "MSC" });
  assert.deepEqual(sms, { ...msbl, game: "SMS" });
  assert.deepEqual(
    [msbl?.seasonWins, msbl?.seasonLosses, msbl?.totalWins, msbl?.totalLosses, msbl?.totalMatches],
    [0, 0, 0, 0, 0],
  );
  assert.deepEqual(
    [msbl?.seasonRank, msbl?.seasonElo, msbl?.currentWhr, msbl?.totalWinPercent],
    [null, null, null, null],
  );
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
  const sms = game(stats, "SMS");
  assert.deepEqual([sms.seasonWins, sms.seasonLosses], [null, null], "no season, no 0-0 for it either");
  assert.equal(msbl.highestSeasonRank, "Silver III", "the history stays");
});

test("real zeros stay zeros; without a match the win rate is undefined", () => {
  const stats = buildProfileStats(
    sets({
      season: SEASON,
      seasonRatings: [{ GameId: 2, Elo: 500, RankNumber: 0, RankName: "Unranked", MatchWins: 0, MatchLosses: 0 }],
      highestRanks: [{ GameId: 2, RankNumber: 0, RankName: "Unranked" }],
      playerStats: [{ GameType: 2, Whr: 1000, MatchWins: 0, MatchLosses: 0 }],
    }),
  );
  const sms = game(stats, "SMS");
  assert.deepEqual(
    [sms.seasonRank, sms.seasonElo, sms.seasonWins, sms.seasonLosses, sms.highestSeasonRank],
    ["Unranked", 500, 0, 0, "Unranked"],
  );
  assert.deepEqual([sms.totalWins, sms.totalLosses, sms.totalMatches, sms.totalWinPercent], [0, 0, 0, null]);
  // A WHR without any rated day is no WHR: PlayerStats keeps 0 (shown 1000) for everyone.
  assert.deepEqual([sms.currentWhr, sms.highestWhr], [null, null]);
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

test("win rate: W / (W + L) × 100 with two decimals", () => {
  assert.equal(winPercent(1, 2), 33.33);
  assert.equal(winPercent(2, 1), 66.67);
  assert.equal(winPercent(324, 80), 80.2);
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
      recordsets: sets({ season: SEASON, playerStats: [{ GameType: 3, Whr: null, MatchWins: 0, MatchLosses: 0 }] }),
    };
  });
  const stats = await getProfileStatsByDiscordId(database, "195905866527014912");
  assert.equal(stats?.games[0]?.totalMatches, 0);
  const batch = database.queries.find((query) => query.sql === buildProfileStatsQuery());
  assert.equal(batch?.inputs.playerId, 223);
  assert.equal(await getProfileStatsByDiscordId(database, "1"), null);
  assert.equal(database.queries.filter((query) => query.sql === buildProfileStatsQuery()).length, 1);
});

test("the response is snake_case: null for '-', zeros for nothing played", () => {
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
    total_wins: 0,
    total_losses: 0,
    total_matches: 0,
    total_win_percent: null,
    highest_legacy_rank: null,
  });
});
