const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildAccolades,
  buildRatings,
  buildPlayerProfileBatchQuery,
  buildPlayerProfileFromRecordsets,
  buildPlayersListQuery,
  buildPlayerDisplayName,
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
  assert.equal(ratings.sms.rank_icon_url, "/assets/leaderboards/rankicons/6-master-I.png");
  assert.equal(ratings.sms.rank_emoji, "");

  assert.equal(ratings.msbl2v2.rating, 1029);
  assert.equal(ratings.msbl2v2.sets, "3-0");
  assert.equal(ratings.msbl2v2.tst, 983);
  assert.equal(ratings.msbl2v2.rank_icon_url, "/assets/leaderboards/rankicons/3-gold-II.png");
  assert.deepEqual(ratings.msc, {});
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
      MatchWins: 1,
      MatchLosses: 0
    }
  ]);

  assert.equal(ratings.msbl.rating, 500);
  assert.equal(ratings.msbl.rank_icon_url, "/assets/players/rewardlevel/0-unranked.png");
  assert.equal(ratings.msbl.competitive_rank, "Unranked");
});

test("season reward level falls back to unranked and maps earned tiers", function () {
  assert.deepEqual(buildSeasonRewardLevel(null), {
    order: 0,
    name: "Unranked",
    image_url: "/assets/players/rewardlevel/0-unranked.png"
  });
  assert.deepEqual(buildSeasonRewardLevel(7), {
    order: 7,
    name: "Strikers Titan",
    image_url: "/assets/players/rewardlevel/7-strikerstitan-b.png"
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
  assert.match(sql, /CompetitiveSeasonRewardProgress/);
  assert.match(sql, /FROM Tournament t/);
  assert.match(sql, /CROSS APPLY \(VALUES/);
  assert.match(sql, /@playerIdText/);
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
      Label: "",
      Code: "SW-0333-7404-4529"
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
      MatchWins: 6,
      MatchLosses: 0
    }],
    [{ RewardLevelOrder: 2 }],
    [{
      Name: "MSBL World Championship",
      Place: ":first_place: ",
      Game: "MSBL",
      TournamentStartDate: new Date("2026-05-15T00:00:00.000Z")
    }]
  ]);

  assert.equal(profile.player.id, 223);
  assert.equal(profile.player.results_url, "https://start.gg/user/goldcobra/results");
  assert.deepEqual(profile.friend_codes.switch, ["1: SW-0333-7404-4529"]);
  assert.equal(profile.ratings.msbl.rating, 703);
  assert.equal(profile.ratings.msbl.sets, "6-0");
  assert.equal(profile.ratings.msbl.whr, 2112);
  assert.equal(profile.ratings.msbl.rank_icon_url, "/assets/leaderboards/rankicons/1-bronze-III.png");
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
