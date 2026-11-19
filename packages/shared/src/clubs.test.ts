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
