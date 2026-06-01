const assert = require("node:assert/strict");
const test = require("node:test");
const {
  compareRosterRows,
  extractDiscordId,
  isActivityActive,
  toActivityIso,
  toRosterRole,
  toMsblClubDTO
} = require("./clubs-service");

const NOW = new Date("2026-05-29T12:00:00.000Z");

function createClubRow(activity) {
  return {
    club_id: 368,
    tag: "ACS",
    name: "AC sTrikers",
    join_conditions: "Invite Only",
    is_open: false,
    region: "EU",
    club_code: "123ABC",
    logo: "https://example.com/logo.webp",
    activity: activity,
    member_count: 9
  };
}

test("Club.Activity NULL is exposed as inactive", function () {
  const row = toMsblClubDTO(createClubRow(null), { now: NOW });

  assert.equal(row.activity, null);
  assert.equal(row.is_active, false);
  assert.equal(row.member_count, 9);
  assert.equal(row.region, "EU");
  assert.equal(row.club_code, "123ABC");
});

test("Club.Activity within 90 days is active", function () {
  const activity = new Date("2026-04-01T12:00:00.000Z");
  const row = toMsblClubDTO(createClubRow(activity), { now: NOW });

  assert.equal(row.activity, "2026-04-01T12:00:00.000Z");
  assert.equal(row.is_active, true);
});

test("Club.Activity older than 90 days is inactive", function () {
  const activity = new Date("2026-01-01T12:00:00.000Z");
  const row = toMsblClubDTO(createClubRow(activity), { now: NOW });

  assert.equal(row.activity, "2026-01-01T12:00:00.000Z");
  assert.equal(row.is_active, false);
});

test("activity helpers normalize invalid values safely", function () {
  assert.equal(toActivityIso(""), null);
  assert.equal(toActivityIso("not a date"), null);
  assert.equal(isActivityActive("not a date", NOW, 90), false);
});

test("extractDiscordId supports raw IDs and mention formats", function () {
  assert.equal(extractDiscordId("709777875686916210"), "709777875686916210");
  assert.equal(extractDiscordId("<@709777875686916210>"), "709777875686916210");
  assert.equal(extractDiscordId("<@!709777875686916210>xshadow39"), "709777875686916210");
  assert.equal(extractDiscordId("not-a-discord-id"), "");
});

test("toRosterRole maps owner/officer/member correctly", function () {
  assert.equal(toRosterRole(true, true), "owner");
  assert.equal(toRosterRole(false, true), "officer");
  assert.equal(toRosterRole(false, false), "member");
});

test("compareRosterRows sorts owner first, then officers A-Z, then members A-Z", function () {
  const rows = [
    { name: "Zulu", is_owner: false, is_officer: false, player_id: 5 },
    { name: "Bravo", is_owner: false, is_officer: true, player_id: 4 },
    { name: "Alpha", is_owner: true, is_officer: false, player_id: 3 },
    { name: "Charlie", is_owner: false, is_officer: true, player_id: 2 },
    { name: "Able", is_owner: false, is_officer: false, player_id: 1 }
  ];

  rows.sort(compareRosterRows);

  assert.deepEqual(
    rows.map(function (row) { return row.name; }),
    ["Alpha", "Bravo", "Charlie", "Able", "Zulu"]
  );
});
