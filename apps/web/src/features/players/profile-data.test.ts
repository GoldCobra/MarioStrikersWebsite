// Profile helpers shared by the player popup and the profile page.

import assert from "node:assert/strict";
import test from "node:test";
import { isWorldChampion } from "./profile-data.ts";

test("a profile is a world champion's once any accolade is an MSL World Championship win", () => {
  assert.equal(isWorldChampion([{ is_winner: true }, { is_world_champion: true }]), true);
  assert.equal(isWorldChampion([{ is_winner: true, is_world_champion: false }]), false);
  assert.equal(isWorldChampion([]), false);
  assert.equal(isWorldChampion(null), false);
  assert.equal(isWorldChampion(undefined), false);
});
