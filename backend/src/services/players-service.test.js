const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildAccolades,
  buildRatings,
  buildPlayerProfileBatchQuery,
  buildPlayerProfileFromRecordsets,
  buildPlayersListQuery,
  buildPlayerDisplayName,
  buildSeasonAwards,
  buildSeasonAwardsQuery,
  SEASON_AWARD_DISPLAY_ORDER,
  buildSeasonRewardLevel,
  buildSeasonRewardLevelQuery,
  isActivityActive,
  normalizeCountry,
  normalizeDiscordId,
  toActivityIso,
  toPlayerListDTO
} = require("./players-service");

const NOW = new Date("2026-05-29T12:00:00.000Z");

function createPlayerRow(activity) {
  return {
    player_id: 223,
    name: "GoldCobra",
    country: "US",
    club_id: 8,
    club_name: "Chaos Edge",
    club_tag: "CE",
    duplicate_name: 0,
    activity: activity
  };
}

test("Player.Activity NULL is exposed as inactive", function () {
  const row = toPlayerListDTO(createPlayerRow(null), { now: NOW });

  assert.equal(row.activity, null);
  assert.equal(row.is_active, false);
  assert.equal(row.name, "GoldCobra");
  assert.equal(row.display_name, "GoldCobra");
  assert.equal(row.country, "us");
  assert.equal(row.club_id, 8);
  assert.equal(row.club_name, "Chaos Edge");
  assert.equal(row.club_tag, "CE");
});

test("Player.Activity within 90 days is active", function () {
  const activity = new Date("2026-04-01T12:00:00.000Z");
  const row = toPlayerListDTO(createPlayerRow(activity), { now: NOW });

  assert.equal(row.activity, "2026-04-01T12:00:00.000Z");
  assert.equal(row.is_active, true);
});

test("Player.Activity older than 90 days is inactive", function () {
  const activity = new Date("2026-01-01T12:00:00.000Z");
  const row = toPlayerListDTO(createPlayerRow(activity), { now: NOW });

  assert.equal(row.activity, "2026-01-01T12:00:00.000Z");
  assert.equal(row.is_active, false);
});

test("player activity helpers normalize invalid values safely", function () {
  assert.equal(toActivityIso(""), null);
  assert.equal(toActivityIso("not a date"), null);
  assert.equal(isActivityActive("not a date", NOW, 90), false);
});

test("player country flags normalize UK subdivision aliases", function () {
  assert.equal(normalizeCountry("GB-WLS"), "gb-wls");
  assert.equal(normalizeCountry("England"), "gb-eng");
  assert.equal(normalizeCountry("UK"), "gb");
  assert.equal(normalizeCountry("CA"), "ca");
  assert.equal(toPlayerListDTO(Object.assign(createPlayerRow(null), { country: "GB-SCT" })).country, "gb-sct");
});

test("duplicate player names get a club tag display suffix", function () {
  const row = toPlayerListDTO({
    player_id: 2215,
    name: "Wally",
    club_tag: "CB",
    duplicate_name: 1
  }, { now: NOW });

  assert.equal(row.name, "Wally");
  assert.equal(row.display_name, "Wally [CB]");
});

test("duplicate player names without club tag get a player id display suffix", function () {
  assert.equal(buildPlayerDisplayName({
    player_id: 1264,
    duplicate_name: true
  }, "Wally"), "Wally [#1264]");
});

test("normalizeDiscordId supports raw IDs and mention formats", function () {
  assert.equal(normalizeDiscordId("709777875686916210"), "709777875686916210");
  assert.equal(normalizeDiscordId("<@709777875686916210>"), "709777875686916210");
  assert.equal(normalizeDiscordId("<@!709777875686916210>xshadow39"), "709777875686916210");
  assert.equal(normalizeDiscordId("not-a-discord-id"), "");
});

test("profile rating cards use Competitive ELO, sets and rank icons", function () {
  const ratings = buildRatings({
    SmsElo: 2017,
    SmsMatchRecord: "155-24",
    SmsRating: 1641,
    SmsRecord: "259-159",
    SmsRank: "<:legacy:1>",
    BlRating2v2: 983,
    BlRecord2v2: "8-3"
  }, [
    {
      GameType: 2,
      Mode: "1v1",
      Elo: 1756.6,
      RankNumber: 16,
      RankName: "Master I",
      MatchWins: 4,
      MatchLosses: 1
    },
    {
      GameType: 3,
      Mode: "2v2",
      Elo: 1029.4,
      RankNumber: 8,
      RankName: "Gold II",
      MatchWins: 3,
      MatchLosses: 0
    }
  ]);

  assert.equal(ratings.sms.rating, 1757);
  assert.equal(ratings.sms.sets, "4-1");
  assert.equal(ratings.sms.whr, 1641);
  assert.equal(ratings.sms.games, "259-159");
  assert.equal(ratings.sms.competitive_rank, "Master I");
  assert.equal(ratings.sms.rank_icon_url, "/assets/leaderboards/rankicons/6-master-I.png?v=20260608-rank-crop-v1");
  assert.equal(ratings.sms.rank_emoji, "");
  assert.deepEqual(ratings.sms.season_reward_level, {
    order: 1,
    name: "Bronze",
    image_url: "/assets/players/rewardlevel/1-bronze.png?v=20260608-rank-crop-v1",
    current_wins: 0,
    required_wins: 5
  });

  assert.equal(ratings.msbl2v2.rating, 1029);
  assert.equal(ratings.msbl2v2.sets, "3-0");
  assert.equal(ratings.msbl2v2.tst, 983);
  assert.equal(ratings.msbl2v2.rank_icon_url, "/assets/leaderboards/rankicons/3-gold-II.png?v=20260608-rank-crop-v1");
  assert.deepEqual(ratings.msc, {});
});

test("profile rating cards attach per-game current season reward progress", function () {
  const ratings = buildRatings({}, [
    {
      GameType: 2,
      Mode: "1v1",
      Elo: 612,
      RankNumber: 4,
      RankName: "Silver I",
      MatchWins: 2,
      MatchLosses: 0
    },
    {
      GameType: 3,
      Mode: "2v2",
      Elo: 701,
      RankNumber: 19,
      RankName: "Strikers Titan",
      MatchWins: 8,
      MatchLosses: 1
    }
  ], [
    {
      GameId: 2,
      ModeCode: "1v1",
      HighestEarnedTierOrder: 1,
      CurrentTargetTierOrder: 2,
      CurrentTargetWins: 2,
      RequiredWins: 5
    },
    {
      GameId: 3,
      ModeCode: "2v2",
      HighestEarnedTierOrder: 7,
      CurrentTargetTierOrder: null,
      CurrentTargetWins: 0,
      RequiredWins: 5
    }
  ]);

  assert.deepEqual(ratings.sms.season_reward_level, {
    order: 2,
    name: "Silver",
    image_url: "/assets/players/rewardlevel/2-silver.png?v=20260608-rank-crop-v1",
    current_wins: 2,
    required_wins: 5
  });
  assert.deepEqual(ratings.msbl2v2.season_reward_level, {
    order: 7,
    name: "Strikers Titan",
    image_url: "/assets/players/rewardlevel/7-strikerstitan-b.png?v=20260608-rank-crop-v1",
    current_wins: 5,
    required_wins: 5
  });
});

test("profile rating cards show a just-completed tier at full until the next tier starts", function () {
  const ratings = buildRatings({}, [
    {
      GameType: 1,
      Mode: "1v1",
      Elo: 700,
      RankNumber: 3,
      RankName: "Bronze III",
      MatchWins: 10,
      MatchLosses: 0,
      PlacementPlayed: 10,
      PlacementComplete: true
    },
    {
      GameType: 2,
      Mode: "1v1",
      Elo: 760,
      RankNumber: 4,
      RankName: "Silver I",
      MatchWins: 13,
      MatchLosses: 0,
      PlacementPlayed: 13,
      PlacementComplete: true
    }
  ], [
    {
      GameId: 1,
      ModeCode: "1v1",
      HighestEarnedTierOrder: 1,
      CurrentTargetTierOrder: 2,
      CurrentTargetWins: 0,
      RequiredWins: 5
    },
    {
      GameId: 2,
      ModeCode: "1v1",
      HighestEarnedTierOrder: 1,
      CurrentTargetTierOrder: 2,
      CurrentTargetWins: 3,
      RequiredWins: 5
    }
  ]);

  assert.deepEqual(ratings.msc.season_reward_level, {
    order: 1,
    name: "Bronze",
    image_url: "/assets/players/rewardlevel/1-bronze.png?v=20260608-rank-crop-v1",
    current_wins: 5,
    required_wins: 5
  });
  assert.deepEqual(ratings.sms.season_reward_level, {
    order: 2,
    name: "Silver",
    image_url: "/assets/players/rewardlevel/2-silver.png?v=20260608-rank-crop-v1",
    current_wins: 3,
    required_wins: 5
  });
});

test("profile rating cards show the current bronze reward target after placements complete", function () {
  const ratings = buildRatings({}, [
    {
      GameType: 1,
      Mode: "1v1",
      Elo: 705,
      RankNumber: 3,
      RankName: "Bronze III",
      MatchWins: 5,
      MatchLosses: 0,
      PlacementPlayed: 5,
      PlacementComplete: true
    },
    {
      GameType: 2,
      Mode: "1v1",
      Elo: 602,
      RankNumber: 1,
      RankName: "Bronze I",
      MatchWins: 0,
      MatchLosses: 5,
      PlacementPlayed: 5,
      PlacementComplete: true
    }
  ], [
    {
      GameId: 1,
      ModeCode: "1v1",
      HighestEarnedTierOrder: 0,
      CurrentTargetTierOrder: 1,
      CurrentTargetWins: 0,
      RequiredWins: 5
    }
  ]);

  assert.deepEqual(ratings.msc.season_reward_level, {
    order: 1,
    name: "Bronze",
    image_url: "/assets/players/rewardlevel/1-bronze.png?v=20260608-rank-crop-v1",
    current_wins: 0,
    required_wins: 5
  });
  assert.deepEqual(ratings.sms.season_reward_level, {
    order: 1,
    name: "Bronze",
    image_url: "/assets/players/rewardlevel/1-bronze.png?v=20260608-rank-crop-v1",
    current_wins: 0,
    required_wins: 5
  });
});

test("profile rating cards show an unranked icon for competitive rank zero", function () {
  const ratings = buildRatings({
    BlRating: 2112,
    BlRecord: "454-117"
  }, [
    {
      GameType: 3,
      Mode: "1v1",
      Elo: 500,
      RankNumber: 0,
      RankName: "Unranked",
      PlacementPlayed: 1,
      PlacementComplete: false,
      MatchWins: 1,
      MatchLosses: 0
    }
  ]);

  assert.equal(ratings.msbl.rating, 500);
  assert.equal(ratings.msbl.rank_icon_url, "/assets/players/rewardlevel/0-unranked.png?v=20260608-rank-crop-v1");
  assert.equal(ratings.msbl.competitive_rank, "Unranked");
  assert.deepEqual(ratings.msbl.season_reward_level, {
    order: 0,
    name: "Unranked",
    image_url: "/assets/players/rewardlevel/0-unranked.png?v=20260608-rank-crop-v1",
    current_wins: 1,
    required_wins: 5
  });
});

test("season reward level falls back to unranked and maps earned tiers", function () {
  assert.deepEqual(buildSeasonRewardLevel(null), {
    order: 0,
    name: "Unranked",
    image_url: "/assets/players/rewardlevel/0-unranked.png?v=20260608-rank-crop-v1"
  });
  assert.deepEqual(buildSeasonRewardLevel(7), {
    order: 7,
    name: "Strikers Titan",
    image_url: "/assets/players/rewardlevel/7-strikerstitan-b.png?v=20260608-rank-crop-v1"
  });
});

test("season reward level query reads highest earned progress from the active season", function () {
  const sql = buildSeasonRewardLevelQuery();

  assert.match(sql, /CompetitiveSeasonRewardProgress/);
  assert.match(sql, /MAX\(ISNULL\(progress\.HighestEarnedTierOrder, 0\)\)/);
  assert.match(sql, /progress\.PlayerId = @playerId/);
  assert.match(sql, /season\.IsActive = 1/);
  assert.match(sql, /season\.LifecycleStatus = 'active'/);
});

test("profile batch query reads all profile data in one multi-recordset batch", function () {
  const sql = buildPlayerProfileBatchQuery();

  assert.match(sql, /SELECT TOP 1\s+p\.ID AS player_id/s);
  assert.match(sql, /FROM FriendCodes fc/);
  assert.match(sql, /FROM CompetitiveLeaderboard lb/);
  assert.match(sql, /lb\.PlacementPlayed/);
  assert.match(sql, /lb\.PlacementComplete/);
  assert.match(sql, /CompetitiveSeasonRewardProgress/);
  assert.match(sql, /progress\.GameId/);
  assert.match(sql, /progress\.ModeCode/);
  assert.match(sql, /progress\.CurrentTargetTierOrder/);
  assert.match(sql, /progress\.CurrentTargetWins/);
  assert.match(sql, /FROM Tournament t/);
  assert.match(sql, /CROSS APPLY \(VALUES/);
  assert.match(sql, /LEFT JOIN PlayerStats ps ON ps\.Player = p\.ID AND ps\.GameType IN \(1, 2, 3\)/);
  assert.match(sql, /@playerIdText/);
  assert.doesNotMatch(sql, /ProfileZest/);
  assert.doesNotMatch(sql, /RankImage/);
  assert.doesNotMatch(sql, /LEFT JOIN Enumeration .*Rank/i);
  assert.doesNotMatch(sql, /GROUP BY Player/);
  assert.doesNotMatch(sql, /UNION ALL/);
});

test("profile batch recordsets map to the existing profile DTO shape", function () {
  const profile = buildPlayerProfileFromRecordsets([
    [{
      player_id: 223,
      name: "GoldCobra",
      country: "DE",
      id_start_gg: "goldcobra",
      club_id: 8,
      club_name: "Chaos Edge",
      club_tag: "CE",
      activity: new Date("2026-06-01T12:00:00.000Z")
    }],
    [{
      GameType: 3,
      Region: "",
      LineSeq: 1,
      Label: "Switch",
      Code: "SW-0333-7404-4529"
    }, {
      GameType: 1,
      Region: "KOR",
      LineSeq: 1,
      Label: "Korea",
      Code: "3141 3518 9838"
    }, {
      GameType: 1,
      Region: "PAL",
      LineSeq: 1,
      Label: "Dolphin",
      Code: "4859-3388-1672"
    }, {
      GameType: 1,
      Region: "JPN",
      LineSeq: 1,
      Label: "Japan",
      Code: "056834577367"
    }, {
      GameType: 1,
      Region: "NTSC",
      LineSeq: 1,
      Label: "USA",
      Code: "3274-1757-7014"
    }],
    [{
      BlRating: 2112,
      BlRecord: "454-117"
    }],
    [{
      GameType: 3,
      Mode: "1v1",
      Elo: 703.2,
      RankNumber: 3,
      RankName: "Bronze III",
      PlacementPlayed: 5,
      PlacementComplete: true,
      MatchWins: 6,
      MatchLosses: 0
    }],
    [{ RewardLevelOrder: 2 }],
    [{
      GameId: 3,
      ModeCode: "1v1",
      HighestEarnedTierOrder: 0,
      CurrentTargetTierOrder: 1,
      CurrentTargetWins: 2,
      RequiredWins: 5
    }],
    [{
      Name: "MSBL World Championship",
      Place: ":first_place: ",
      Game: "MSBL",
      TournamentStartDate: new Date("2026-05-15T00:00:00.000Z")
    }]
  ]);

  assert.equal(profile.player.id, 223);
  assert.equal(profile.player.results_url, "https://start.gg/user/goldcobra/results");
  assert.deepEqual(profile.friend_codes.switch, ["SW-0333-7404-4529"]);
  assert.deepEqual(profile.friend_codes.msc, [
    "PAL (Dolphin): 4859-3388-1672",
    "NTSC-U (USA): 3274-1757-7014",
    "NTSC-J (Japan): 0568-3457-7367",
    "NTSC-K (Korea): 3141-3518-9838"
  ]);
  assert.deepEqual(profile.friend_codes.msc_pal, ["PAL (Dolphin): 4859-3388-1672"]);
  assert.equal(profile.ratings.msbl.rating, 703);
  assert.equal(profile.ratings.msbl.sets, "6-0");
  assert.equal(profile.ratings.msbl.whr, 2112);
  assert.equal(profile.ratings.msbl.rank_icon_url, "/assets/leaderboards/rankicons/1-bronze-III.png?v=20260608-rank-crop-v1");
  assert.equal(profile.ratings.msbl.season_reward_level.name, "Bronze");
  assert.equal(profile.ratings.msbl.season_reward_level.current_wins, 2);
  assert.equal(profile.ratings.msbl.season_reward_level.required_wins, 5);
  assert.equal(profile.season_reward_level.name, "Silver");
  assert.equal(profile.accolades[0].place_medal, "🥇");
});

test("profile accolades mapper handles all placements and keeps newest first", function () {
  const accolades = buildAccolades([
    {
      Name: "Older Cup",
      Place: ":third_place: ",
      Game: "MSC",
      TournamentStartDate: new Date("2024-01-01T00:00:00.000Z")
    },
    {
      Name: "Newer Cup",
      Place: ":second_place: ",
      Game: "SMS",
      TournamentStartDate: new Date("2025-01-01T00:00:00.000Z")
    }
  ]);

  assert.equal(accolades[0].tournament_name, "Newer Cup");
  assert.equal(accolades[0].place_medal, "🥈");
  assert.equal(accolades[1].place_medal, "🥉");
});

test("players list only includes rows with visible profile content", function () {
  const sql = buildPlayersListQuery();

  assert.match(sql, /FriendCodes/);
  assert.match(sql, /CompetitiveLeaderboard/);
  assert.match(sql, /Tournament/);
  assert.match(sql, /IdStartGG/);
  assert.doesNotMatch(sql, /FROM PlayerStats ps/);
});

test("buildSeasonAwards maps award rows and keeps the SQL ordering", function () {
  const awards = buildSeasonAwards([
    {
      SeasonName: "Burst Season 2026",
      Game: "msbl",
      ModeCode: "1v1",
      AwardCode: "TOP_10",
      AwardName: "Top 10",
      RankPosition: 3,
      MetricLabel: "865.57 ELO"
    },
    {
      SeasonName: "Burst Season 2026",
      Game: "MSC",
      ModeCode: "1v1",
      AwardCode: "IRON_PLAYER",
      AwardName: "Iron Player",
      RankPosition: 1,
      MetricLabel: "33 matches"
    }
  ]);

  assert.equal(awards.length, 2);
  assert.deepEqual(awards[0], {
    season_name: "Burst Season 2026",
    game_code: "MSBL",
    mode_code: "1v1",
    award_code: "TOP_10",
    award_name: "Top 10",
    rank_position: 3,
    metric_label: "865.57 ELO"
  });
  assert.equal(awards[1].game_code, "MSC");
  assert.equal(awards[1].award_name, "Iron Player");
});

test("buildSeasonAwards drops rows without a season or award name", function () {
  const awards = buildSeasonAwards([
    { SeasonName: "", AwardName: "Top 10" },
    { SeasonName: "Burst Season 2026", AwardName: "" },
    { SeasonName: "Burst Season 2026", AwardName: "Most Wins", Game: "SMS" }
  ]);

  assert.equal(awards.length, 1);
  assert.equal(awards[0].award_name, "Most Wins");
});

test("buildSeasonAwards tolerates a missing or non-array recordset", function () {
  assert.deepEqual(buildSeasonAwards(null), []);
  assert.deepEqual(buildSeasonAwards(undefined), []);
  assert.deepEqual(buildSeasonAwards("nope"), []);
});

test("buildSeasonAwardsQuery selects award rows for the requested player", function () {
  const sql = buildSeasonAwardsQuery();

  assert.match(sql, /CompetitiveSeasonAwardResult/);
  assert.match(sql, /CompetitiveSeasonAwardResultPlayer/);
  assert.match(sql, /resultPlayer\.PlayerId = @playerId/);
  assert.match(sql, /ORDER BY season\.StartDateUtc DESC/);
});

test("buildSeasonAwardsQuery orders awards by prestige, not by award code", function () {
  const sql = buildSeasonAwardsQuery();

  // The old ordering sorted alphabetically by AwardCode, which put CLUTCH_PLAYER
  // above TOP_10. Ordering must come from SEASON_AWARD_DISPLAY_ORDER instead.
  assert.match(sql, /CASE result\.AwardCode WHEN 'TOP_10' THEN 0 /);
  assert.match(sql, /WHEN 'DUO_OF_THE_SEASON' THEN 8 /);
  assert.match(sql, /ELSE 9 END ASC/);

  // Grouping stays season -> game -> mode, and TOP_10 keeps its 1..10 run.
  assert.match(sql, /result\.GameId ASC, result\.ModeCode ASC/);
  assert.match(sql, /result\.RankPosition ASC;$/);
});

test("SEASON_AWARD_DISPLAY_ORDER covers every award futbot writes, without duplicates", function () {
  // Mirrors futbot's SEASON_AWARD_DEFINITIONS; a drift here silently reorders profiles.
  assert.deepEqual(SEASON_AWARD_DISPLAY_ORDER, [
    "TOP_10",
    "MOST_WINS",
    "BIGGEST_UPSET",
    "CLUTCH_PLAYER",
    "SWEEP_SPECIALIST",
    "COMEBACK_KING",
    "MOST_ACTIVE",
    "IRON_PLAYER",
    "DUO_OF_THE_SEASON"
  ]);
  assert.equal(new Set(SEASON_AWARD_DISPLAY_ORDER).size, SEASON_AWARD_DISPLAY_ORDER.length);
});
