// Players by their name on the Discord server (docs/adr/0015): who is listed, by which name, and how players who
// share a name are told apart.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlayerProfile } from "./mappers.ts";
import {
  buildPlayerList,
  clubTagList,
  listedName,
  serverName,
  withListedName,
  withoutClubTags,
  type ListProfile,
  type MemberNames,
} from "./server-names.ts";

const TAGS = clubTagList(["KFC", "kfc", "]IB[", "H.O.F", "K", " ", "CRUZ"]);

const member = (names: Partial<MemberNames>): MemberNames => ({ username: "", globalName: "", nick: "", ...names });

function profile(playerId: number, discordId: string, extra: Partial<ListProfile> = {}): ListProfile {
  return { playerId, discordId, country: "", activity: null, isActive: false, ...extra };
}

test("club tags are taken once in any case, longest first", () => {
  assert.deepEqual(TAGS, ["H.O.F", "]IB[", "CRUZ", "KFC", "K"]);
});

test("only real club tags in front are removed, in any case and doubled; a bracket the member writes stays", () => {
  assert.equal(withoutClubTags("[KFC] Virt", TAGS), "Virt");
  assert.equal(withoutClubTags("[kfc]Virt", TAGS), "Virt");
  assert.equal(withoutClubTags("[KFC] [KFC] Virt", TAGS), "Virt");
  assert.equal(withoutClubTags("[]IB[] Old Guard", TAGS), "Old Guard");
  assert.equal(withoutClubTags("[H.O.F] Famer", TAGS), "Famer");
  assert.equal(withoutClubTags("[K] Short", TAGS), "Short");
  assert.equal(withoutClubTags("[TTV] Streamer", TAGS), "[TTV] Streamer");
  assert.equal(withoutClubTags("[KFC] [TTV] Streamer", TAGS), "[TTV] Streamer");
  assert.equal(withoutClubTags("Vi [KFC] rt", TAGS), "Vi [KFC] rt");
  assert.equal(withoutClubTags("  [KFC]  ", TAGS), "");
});

test("the server name is the nickname, else the global name, else the username, each without club tags", () => {
  assert.equal(serverName(member({ nick: "[KFC] Virt", globalName: "Virtuoso", username: "virt" }), TAGS), "Virt");
  assert.equal(serverName(member({ nick: "", globalName: "Hydron_8", username: "hydron_8_65732" }), TAGS), "Hydron_8");
  assert.equal(serverName(member({ username: "hydron_8_65732" }), TAGS), "hydron_8_65732");
  // A nickname that is only the tag falls back to the next name.
  assert.equal(
    serverName(member({ nick: "[CRUZ]", globalName: "[CRUZ] motchete", username: "m14" }), TAGS),
    "motchete",
  );
  assert.equal(serverName(member({}), TAGS), "");
});

test("the list holds exactly the profiles whose Discord account is on the server, by server name", () => {
  const members = new Map<string, MemberNames>([
    ["111", member({ nick: "[KFC] Virt", username: "virt" })],
    ["222", member({ globalName: "Hydron_8", username: "hydron_8_65732" })],
    ["999", member({ username: "no_profile" })],
  ]);
  const rows = buildPlayerList(
    [
      profile(1632, "111", { country: "gb-eng", activity: "2026-11-20T10:00:00.000Z", isActive: true }),
      profile(2527, "222", { country: "es" }),
      profile(225, "333"), // left the server: stays in the database, never listed
    ],
    members,
    TAGS,
  );
  assert.deepEqual(rows, [
    { player_id: 2527, name: "Hydron_8", country: "es", activity: null, is_active: false },
    { player_id: 1632, name: "Virt", country: "gb-eng", activity: "2026-11-20T10:00:00.000Z", is_active: true },
  ]);
  assert.deepEqual(buildPlayerList([profile(1, "111")], new Map(), TAGS), []);
});

test("players who share a server name (in any case) are all listed, each with the username", () => {
  const members = new Map<string, MemberNames>([
    ["1", member({ nick: "[KFC] Spiky", username: "spiky123" })],
    ["2", member({ globalName: "spiky", username: "spiky_tm" })],
    ["3", member({ globalName: "Spiky Jr", username: "junior" })],
  ]);
  const rows = buildPlayerList([profile(2496, "1"), profile(3001, "2"), profile(3002, "3")], members, TAGS);
  assert.deepEqual(
    rows.map((row) => [row.player_id, row.name]),
    [
      [2496, "Spiky (@spiky123)"],
      [3001, "spiky (@spiky_tm)"],
      [3002, "Spiky Jr"],
    ],
  );
});

test("the popup finds a listed player's name in the list payload; nobody else has one", () => {
  const payload = { count: 1, rows: [{ player_id: 2496, name: "Spiky (@spiky123)" }] };
  assert.equal(listedName(payload, 2496), "Spiky (@spiky123)");
  assert.equal(listedName(payload, 225), null);
  assert.equal(listedName(null, 2496), null);
  assert.equal(listedName({ rows: "broken" }, 2496), null);
});

test("the popup goes by the list's name for a listed player; anyone else keeps the stored name", () => {
  const profile = { player: { id: 2527, name: "hydron_8_65732" } } as unknown as PlayerProfile;
  const list = { count: 1, rows: [{ player_id: 2527, name: "Hydron_8" }] };
  assert.equal(withListedName(profile, list).player.name, "Hydron_8");
  assert.equal(profile.player.name, "hydron_8_65732", "the profile itself stays as it was");
  assert.equal(withListedName(profile, { count: 0, rows: [] }), profile);
  assert.equal(withListedName(profile, null), profile);
});
