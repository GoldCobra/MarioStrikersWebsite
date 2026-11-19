import assert from "node:assert/strict";
import test from "node:test";
import {
  CLUB_PUBLIC_ID_ALPHABET,
  CLUB_REGIONS,
  CLUB_STADIUMS,
  CLUB_UNIFORMS,
  clubNameKey,
  isBlockedClubTag,
  isClubPublicId,
  isDiscordInviteUrl,
  isUniformPair,
  normalizeClubName,
  toClubRegion,
  toClubStadium,
  toClubUniform,
  validateClubSettings,
  validateNewClub,
  type ClubSettingsValue,
} from "./clubs.ts";

test("the club id alphabet has 57 symbols without look-alikes", () => {
  assert.equal(CLUB_PUBLIC_ID_ALPHABET.length, 57);
  assert.equal(new Set(CLUB_PUBLIC_ID_ALPHABET).size, 57);
  for (const lookalike of ["0", "O", "1", "l", "I"]) assert.equal(CLUB_PUBLIC_ID_ALPHABET.includes(lookalike), false);
  assert.equal(isClubPublicId("Ab3dEf9h"), true);
  assert.equal(isClubPublicId("Ab3dEf9"), false, "seven characters");
  assert.equal(isClubPublicId("Ab3dEf9hX"), false, "nine characters");
  assert.equal(isClubPublicId("Ab3dEf0h"), false, "a zero");
  assert.equal(isClubPublicId("Ab3d f9h"), false, "a space");
});

test("the value lists are the game's and the bot's", () => {
  assert.deepEqual(
    CLUB_REGIONS.map((region) => region.value),
    ["EU", "NA", "SA", "SSA", "APAC", "OCE", "MENA", "Other"],
  );
  assert.equal(CLUB_UNIFORMS.length, 12);
  assert.equal(CLUB_STADIUMS.length, 8);
  assert.equal(toClubRegion("europe"), "EU");
  assert.equal(toClubRegion(" other "), "Other");
  assert.equal(toClubRegion("Mars"), "");
  assert.equal(toClubUniform("turquoise"), "Turquoise");
  assert.equal(toClubUniform("o.red"), "", "legacy colour codes are no colour of the list");
  assert.equal(toClubStadium("desert ruin"), "Desert Ruin");
  assert.equal(toClubStadium("Pipeline Central"), "");
});

test("uniforms pair a warm with a cool colour", () => {
  assert.equal(isUniformPair("Red", "Blue"), true);
  assert.equal(isUniformPair("Black", "Yellow"), true);
  assert.equal(isUniformPair("Red", "Green"), false);
  assert.equal(isUniformPair("Grey", "Violet"), false);
});

test("names compare without case and spacing, blocked tags in any case", () => {
  assert.equal(normalizeClubName("  Hammer   Bros \t"), "Hammer Bros");
  assert.equal(clubNameKey("hammer  bros"), clubNameKey(" Hammer Bros"));
  for (const tag of ["mod", "Admin", "ADM", "owner "]) assert.equal(isBlockedClubTag(tag), true, tag);
  assert.equal(isBlockedClubTag("MODS"), false);
});

test("only Discord invite links count as a club's Discord", () => {
  for (const url of [
    "https://discord.gg/abc123",
    "http://www.discord.gg/abc",
    "https://discord.com/invite/abc",
    "https://discordapp.com/invite/abc",
  ]) {
    assert.equal(isDiscordInviteUrl(url), true, url);
  }
  for (const url of [
    "https://discord.io/h0axttv",
    "https://discord.com/channels/1/2",
    "https://discord.gg/",
    "ftp://discord.gg/abc",
    "discord.gg/abc",
  ]) {
    assert.equal(isDiscordInviteUrl(url), false, url);
  }
});

const SETTINGS = {
  is_open: true,
  regions: ["eu", "North America"],
  club_codes: ["ABC1234"],
  first_uniform: "red",
  second_uniform: "Blue",
  stadium: "planetoid",
  discord_url: "https://discord.gg/abc",
};

function settingsErrors(input: unknown, stored?: ClubSettingsValue): string[] {
  const result = validateClubSettings(input, stored);
  return result.ok ? [] : result.errors.map((error) => `${error.field}:${error.code}`);
}

test("valid settings come back in their stored form", () => {
  assert.deepEqual(validateClubSettings(SETTINGS), {
    ok: true,
    value: {
      isOpen: true,
      regions: ["EU", "NA"],
      clubCodes: ["ABC1234"],
      firstUniform: "Red",
      secondUniform: "Blue",
      stadium: "Planetoid",
      discordUrl: "https://discord.gg/abc",
    },
  });
  const minimal = { is_open: false, regions: ["SSA"], club_codes: ["ZZZ9999"] };
  assert.equal(validateClubSettings(minimal).ok, true, "uniforms, stadium and Discord are optional");
  const short = validateClubSettings({ ...SETTINGS, discord_url: "discord.gg/abc" });
  assert.equal(short.ok && short.value.discordUrl, "https://discord.gg/abc", "a link without https:// gets it");
  assert.deepEqual(settingsErrors({ ...SETTINGS, discord_url: "discord.io/abc" }), ["discord_url:INVALID"]);
});

test("regions and club codes: one to three, from the list, each once", () => {
  assert.deepEqual(settingsErrors({ ...SETTINGS, regions: [] }), ["regions:REQUIRED"]);
  assert.deepEqual(settingsErrors({ ...SETTINGS, regions: ["EU", "NA", "SA", "OCE"] }), ["regions:TOO_MANY"]);
  assert.deepEqual(settingsErrors({ ...SETTINGS, regions: ["EU", "eu"] }), ["regions:DUPLICATE"]);
  assert.deepEqual(settingsErrors({ ...SETTINGS, regions: ["Mars"] }), ["regions:INVALID"]);
  assert.deepEqual(settingsErrors({ ...SETTINGS, club_codes: [] }), ["club_codes:REQUIRED"]);
  assert.deepEqual(settingsErrors({ ...SETTINGS, club_codes: ["ABC123", "ABC1234"] }), ["club_codes.0:INVALID"]);
  assert.deepEqual(settingsErrors({ ...SETTINGS, club_codes: ["ABC1234", "abc1234"] }), ["club_codes.1:DUPLICATE"]);
  assert.deepEqual(settingsErrors({ ...SETTINGS, club_codes: ["AAAAAAA", "BBBBBBB", "CCCCCCC", "DDDDDDD"] }), [
    "club_codes:TOO_MANY",
  ]);
  assert.deepEqual(settingsErrors({ ...SETTINGS, regions: "EU" }), ["regions:INVALID"]);
});

test("uniforms are both or none, one warm and one cool", () => {
  assert.deepEqual(settingsErrors({ ...SETTINGS, second_uniform: "" }), ["uniforms:UNIFORM_PAIR"]);
  assert.deepEqual(settingsErrors({ ...SETTINGS, second_uniform: "Green" }), ["uniforms:UNIFORM_GROUPS"]);
  assert.deepEqual(settingsErrors({ ...SETTINGS, second_uniform: "Silver" }), ["uniforms:INVALID"]);
  assert.deepEqual(settingsErrors({ ...SETTINGS, first_uniform: "", second_uniform: "" }), []);
});

test("an older pair, stadium or link may stay while it is left unchanged", () => {
  const stored: ClubSettingsValue = {
    isOpen: false,
    regions: [],
    clubCodes: [],
    firstUniform: "o.red",
    secondUniform: "b.white",
    stadium: "",
    discordUrl: "https://discord.io/h0axttv",
  };
  const legacy = { ...SETTINGS, first_uniform: "o.red", second_uniform: "b.white", discord_url: stored.discordUrl };
  assert.deepEqual(settingsErrors(legacy, stored), []);
  assert.deepEqual(settingsErrors(legacy), ["uniforms:INVALID", "discord_url:INVALID"], "without the stored values");
  assert.deepEqual(settingsErrors({ ...legacy, second_uniform: "Blue" }, stored), ["uniforms:INVALID"]);
  assert.deepEqual(settingsErrors({ ...SETTINGS, regions: [] }, stored), ["regions:REQUIRED"], "F8: a region now");
});

test("a new club needs a name, a tag that is not blocked, and valid settings", () => {
  const result = validateNewClub({ ...SETTINGS, name: "  Hammer   Bros ", tag: "HB" });
  assert.equal(result.ok, true);
  assert.equal(result.value.name, "Hammer Bros");
  const errors = (input: unknown): string[] => {
    const outcome = validateNewClub(input);
    return outcome.ok ? [] : outcome.errors.map((error) => `${error.field}:${error.code}`);
  };
  assert.deepEqual(errors({ ...SETTINGS, name: "", tag: "" }), ["name:REQUIRED", "tag:REQUIRED"]);
  assert.deepEqual(errors({ ...SETTINGS, name: "Ross’ Strikers", tag: "H.O.F" }), ["name:INVALID", "tag:INVALID"]);
  assert.deepEqual(errors({ ...SETTINGS, name: "x".repeat(51), tag: "TOOLONG" }), ["name:TOO_LONG", "tag:TOO_LONG"]);
  assert.deepEqual(errors({ ...SETTINGS, name: "Staff", tag: "mod" }), ["tag:BLOCKED"]);
  assert.deepEqual(errors({ name: "Club", tag: "CL" }), ["is_open:INVALID", "regions:REQUIRED", "club_codes:REQUIRED"]);
  assert.deepEqual(errors("nope"), ["request:INVALID"]);
});
