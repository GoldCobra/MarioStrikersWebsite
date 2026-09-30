// Profile helpers shared by the player popup and the profile page.

import assert from "node:assert/strict";
import test from "node:test";
import { isWorldChampion, mscFriendCodeLines } from "./profile-data.ts";

test("MSC friend codes leave out the NTSC-J and NTSC-K versions", () => {
  const msc = [
    "PAL (Dolphin): 1111-2222-3333",
    "NTSC-U: 4444-5555-6666",
    "NTSC-J: 7777-8888-9999",
    "NTSC-K (Wii): 1234",
  ];
  assert.deepEqual(mscFriendCodeLines({ msc }), ["PAL (Dolphin): 1111-2222-3333", "NTSC-U: 4444-5555-6666"]);
  assert.deepEqual(mscFriendCodeLines({ msc: ["NTSC-J: 7777-8888-9999"] }), []);
  assert.deepEqual(mscFriendCodeLines({ msc_pal: ["1111-2222-3333"], msc_ntsc: ["4444-5555-6666"] }), [
    "PAL: 1111-2222-3333",
    "NTSC-U: 4444-5555-6666",
  ]);
});

test("a profile is a world champion's once any accolade is an MSL World Championship win", () => {
  assert.equal(isWorldChampion([{ is_winner: true }, { is_world_champion: true }]), true);
  assert.equal(isWorldChampion([{ is_winner: true, is_world_champion: false }]), false);
  assert.equal(isWorldChampion([]), false);
  assert.equal(isWorldChampion(null), false);
  assert.equal(isWorldChampion(undefined), false);
});
