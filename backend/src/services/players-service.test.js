const assert = require("node:assert/strict");
const test = require("node:test");
const {
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
