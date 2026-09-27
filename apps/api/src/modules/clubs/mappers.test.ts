import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeCountryCode } from "@ms/shared/countries";
import { isActivityActive, toActivityIso } from "../../lib/dates.ts";
import { normalizeDiscordId } from "../../lib/discord-id.ts";
import { compareRosterRows, extractDiscordName, toMsblClubDTO, toRosterRole } from "./mappers.ts";

const NOW = new Date("2026-05-29T12:00:00.000Z");

function createClubRow(activity: Date | null): Record<string, unknown> {
  return {
    club_id: 368,
    tag: "ACS",
    name: "AC sTrikers",
    join_conditions: "Invite Only",
    is_open: false,
    region: "EU",
    region2: "NA",
    region3: "APAC",
    club_code: "123ABC",
    club_code2: "456DEF",
    club_code3: "789GHI",
    logo: "https://example.com/logo.webp",
    activity,
    member_count: 9,
  };
}

test("Club.Activity NULL is exposed as inactive", () => {
  const row = toMsblClubDTO(createClubRow(null), { now: NOW });
  assert.equal(row?.activity, null);
  assert.equal(row.is_active, false);
  assert.equal(row.member_count, 9);
  assert.equal(row.region, "EU");
  assert.deepEqual(row.regions, ["EU", "NA", "APAC"]);
  assert.equal(row.club_code, "");
  assert.deepEqual(row.club_codes, []);
});

test("open clubs expose visible club codes", () => {
  const row = toMsblClubDTO({ ...createClubRow(null), is_open: true }, { now: NOW });
  assert.equal(row?.club_code, "123ABC");
  assert.deepEqual(row.club_codes, ["123ABC", "456DEF", "789GHI"]);
});

test("Club.Activity within 90 days is active", () => {
  const row = toMsblClubDTO(createClubRow(new Date("2026-04-01T12:00:00.000Z")), { now: NOW });
  assert.equal(row?.activity, "2026-04-01T12:00:00.000Z");
  assert.equal(row.is_active, true);
});

test("Club.Activity older than 90 days is inactive", () => {
  const row = toMsblClubDTO(createClubRow(new Date("2026-01-01T12:00:00.000Z")), { now: NOW });
  assert.equal(row?.activity, "2026-01-01T12:00:00.000Z");
  assert.equal(row.is_active, false);
});

test("clubs without tag and name are left out, excluded logos are dropped", () => {
  assert.equal(toMsblClubDTO({ tag: "", name: " " }), null);
  const excluded = toMsblClubDTO({ ...createClubRow(null), tag: "STRK", name: "I Be Strikin" });
  assert.equal(excluded?.logo_source, "");
  assert.equal(toMsblClubDTO(createClubRow(null))?.logo_source, "https://example.com/logo.webp");
});

test("activity helpers normalize invalid values safely", () => {
  assert.equal(toActivityIso(""), null);
  assert.equal(toActivityIso("not a date"), null);
  assert.equal(isActivityActive("not a date", NOW, 90), false);
});

test("Discord ids and names are read from mention storage", () => {
  assert.equal(normalizeDiscordId("709777875686916210"), "709777875686916210");
  assert.equal(normalizeDiscordId("<@709777875686916210>"), "709777875686916210");
  assert.equal(normalizeDiscordId("<@!709777875686916210>xshadow39"), "709777875686916210");
  assert.equal(normalizeDiscordId("not-a-discord-id"), "");
  assert.equal(extractDiscordName("<@!709777875686916210>goldcobra111"), "goldcobra111");
  assert.equal(extractDiscordName("<@709777875686916210> GoldCobra"), "GoldCobra");
  assert.equal(extractDiscordName("709777875686916210"), "");
});

test("country flags normalize UK subdivision aliases", () => {
  assert.equal(normalizeCountryCode("GB-ENG"), "gb-eng");
  assert.equal(normalizeCountryCode("england"), "gb-eng");
  assert.equal(normalizeCountryCode("Scotland"), "gb-sct");
  assert.equal(normalizeCountryCode("Wales"), "gb-wls");
  assert.equal(normalizeCountryCode("NIR"), "gb-nir");
  assert.equal(normalizeCountryCode("UK"), "gb");
  assert.equal(normalizeCountryCode("US"), "us");
  assert.equal(normalizeCountryCode("not-a-flag"), "");
});

test("toRosterRole maps owner/officer/member correctly", () => {
  assert.equal(toRosterRole(true, true), "owner");
  assert.equal(toRosterRole(false, true), "officer");
  assert.equal(toRosterRole(false, false), "member");
});

test("compareRosterRows sorts owner first, then officers A-Z, then members A-Z", () => {
  const rows = [
    { name: "Zulu", is_owner: false, is_officer: false, player_id: 5 },
    { name: "Bravo", is_owner: false, is_officer: true, player_id: 4 },
    { name: "Alpha", is_owner: true, is_officer: false, player_id: 3 },
    { name: "Charlie", is_owner: false, is_officer: true, player_id: 2 },
    { name: "Able", is_owner: false, is_officer: false, player_id: 1 },
  ];
  rows.sort(compareRosterRows);
  assert.deepEqual(
    rows.map((row) => row.name),
    ["Alpha", "Bravo", "Charlie", "Able", "Zulu"],
  );
});
