// The player list from the database and the server's member list (docs/adr/0015).

import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError } from "../../http/errors.ts";
import type { GuildMemberSnapshot } from "../../integrations/discord/guild-members.ts";
import { createFakeDatabase } from "../../test-support/fake-database.ts";
import { getPlayersList } from "./service.ts";

const NOW = new Date("2026-11-24T12:00:00.000Z");

function memberList(members: Record<string, { username: string; nick?: string }> | null) {
  const snapshot: GuildMemberSnapshot | null = members && {
    takenAt: NOW.getTime(),
    members: new Map(
      Object.entries(members).map(([id, names]) => [
        id,
        { id, username: names.username, globalName: "", nick: names.nick ?? "", roles: [], joinedAt: null },
      ]),
    ),
  };
  return { get: () => Promise.resolve(snapshot) };
}

test("the player list joins every profile with the member list: members only, by server name, with flag codes", async () => {
  const database = createFakeDatabase(() => ({
    sets: [
      [
        {
          player_id: 1632,
          discord_id: "756535384686461008",
          country: "england",
          activity: new Date("2026-11-20T10:00:00Z"),
        },
        { player_id: 225, discord_id: "100000000000000225", country: "de", activity: null },
      ],
      [{ tag: "KFC" }],
    ],
  }));
  const rows = await getPlayersList(
    database,
    memberList({ "756535384686461008": { username: "virt", nick: "[KFC] Virt" } }),
    {
      now: NOW,
    },
  );
  assert.deepEqual(rows, [
    { player_id: 1632, name: "Virt", country: "gb-eng", activity: "2026-11-20T10:00:00.000Z", is_active: true },
  ]);
});

test("without the member list there is no player list: it could not leave out the players who left", async () => {
  const database = createFakeDatabase(() => ({
    sets: [[{ player_id: 1, discord_id: "1", country: null, activity: null }], []],
  }));
  await assert.rejects(
    getPlayersList(database, memberList(null)),
    (error: unknown) => error instanceof HttpError && error.statusCode === 503 && error.code === "UPSTREAM_UNAVAILABLE",
  );
});
