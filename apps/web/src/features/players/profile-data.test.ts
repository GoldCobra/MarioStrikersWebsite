// Profile helpers shared by the player popup and the profile page.

import assert from "node:assert/strict";
import test from "node:test";
import { gameBallIconUrl, isWorldChampion, titleGameBall, titleLookClass } from "./profile-data.ts";

test("a profile is a world champion's once any accolade is an MSL World Championship win", () => {
  assert.equal(isWorldChampion([{ is_winner: true }, { is_world_champion: true }]), true);
  assert.equal(isWorldChampion([{ is_winner: true, is_world_champion: false }]), false);
  assert.equal(isWorldChampion([]), false);
  assert.equal(isWorldChampion(null), false);
  assert.equal(isWorldChampion(undefined), false);
});

test("a title's look is one class per group, plain when unknown or empty", () => {
  for (const look of ["free", "season", "special", "msl-world", "msl", "tournament", "tournament-x5", "legacy"]) {
    assert.equal(titleLookClass(look), `player-title-look is-look-${look}`);
  }
  assert.equal(titleLookClass(" MSL-World "), "player-title-look is-look-msl-world");
  assert.equal(titleLookClass(""), "player-title-look is-look-plain");
  assert.equal(titleLookClass(undefined), "player-title-look is-look-plain");
  assert.equal(titleLookClass('x" onclick="y'), "player-title-look is-look-xonclicky");
});

test("a title's game ball is the accolades' ball of that game, and none for a title without a game", () => {
  assert.deepEqual(titleGameBall("MSBL"), {
    src: "../assets/nav-buttons/sub/msblball.webp",
    fallback: "../assets/nav-buttons/sub/msblball.png",
    alt: "MSBL",
  });
  assert.equal(titleGameBall(" msc ")?.src, gameBallIconUrl("MSC"));
  assert.equal(titleGameBall("SMS")?.alt, "SMS");
  // Unlike the accolades (which fall back to the SMS ball), an unknown or missing game shows no ball.
  for (const none of ["", "?", undefined, null, "wii"]) assert.equal(titleGameBall(none), null);
});
