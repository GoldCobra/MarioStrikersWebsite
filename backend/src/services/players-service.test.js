const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildRatings,
  buildPlayerDisplayName,
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
