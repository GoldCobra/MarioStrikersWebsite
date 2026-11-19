import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryClubStore, type MemoryClub } from "../../fixtures/club-store.ts";
import type { GuildMemberSnapshot } from "../../integrations/discord/guild-members.ts";
import { silentLogger } from "../../lib/logger.ts";
import { absenceDue, createClubLifecycle } from "./lifecycle.ts";
import { DAY_MS } from "./rules.ts";

const NOW = Date.parse("2026-12-01T12:00:00.000Z");
const id = (playerId: number): string => `2000000000000000${String(playerId).padStart(2, "0")}`;

function club(clubId: number, extra: Partial<MemoryClub> = {}): MemoryClub {
  return {
    clubId,
    publicId: `Club${String(clubId).padStart(4, "A")}`,
    name: `Club ${String(clubId)}`,
    tag: `C${String(clubId)}`,
    ownerDiscordId: id(clubId),
    settings: {
      isOpen: true,
      regions: ["EU"],
      clubCodes: ["ABC1234"],
      firstUniform: "",
      secondUniform: "",
      stadium: "",
      discordUrl: "",
    },
    logoUrl: "",
    createdAt: NOW - 400 * DAY_MS,
    establishedAt: NOW - 300 * DAY_MS,
    streakSince: null,
    inactiveSince: null,
    inactiveWarnedAt: null,
    deletionWarnedAt: null,
    activity: null,
    ...extra,
  };
}

/** Club 1 (established, captain 1 + member 2), club 3 (new, 30 days alone, captain 3); players 1–5. */
function setup(options: { goLive?: boolean; present?: number[]; snapshotAge?: number } = {}) {
  const store = createMemoryClubStore({
    clubs: [club(1), club(3, { createdAt: NOW - 30 * DAY_MS, establishedAt: null })],
    players: [1, 2, 3, 4, 5].map((playerId) => ({
      playerId,
      discordId: id(playerId),
      name: `P${String(playerId)}`,
      country: "",
    })),
    mode: { mode: "on", goLiveAt: options.goLive === false ? null : NOW - 30 * DAY_MS },
  });
  store.addMember(1, 1, { isOfficer: true });
  store.addMember(1, 2);
  store.addMember(3, 3, { isOfficer: true });
  const clock = { now: NOW };
  const present = new Set((options.present ?? [1, 2, 3, 4, 5]).map(id));
  const snapshot: GuildMemberSnapshot = {
    takenAt: NOW - (options.snapshotAge ?? 0),
    members: new Map(
      [...present].map((discordId) => [
        discordId,
        { id: discordId, username: "", globalName: "", nick: "", roles: [], joinedAt: 0 },
      ]),
    ),
  };
  const changes: string[] = [];
  const lifecycle = createClubLifecycle({
    store,
    // The list is read fresh at every run (the clock moves), its age as given.
    memberList: { get: () => Promise.resolve({ ...snapshot, takenAt: clock.now - (options.snapshotAge ?? 0) }) },
    log: silentLogger,
    intervalMs: 0,
    now: () => clock.now,
    onChange: () => changes.push("change"),
  });
  return { store, lifecycle, changes, clock };
}

test("a run marks a new club alone for 30 days inactive and leaves established clubs alone", async () => {
  const { store, lifecycle, changes } = setup();
  const report = await lifecycle.run();
  assert.equal(report.newClubChanges, 1);
  assert.equal(store.clubs.get(3)?.inactiveSince, NOW);
  assert.ok(store.events.some((event) => event.type === "club.marked_inactive" && event.clubId === 3));
  assert.equal(store.clubs.get(1)?.inactiveSince, null);
  assert.deepEqual(changes, ["change"]);
  const again = await lifecycle.run();
  assert.equal(again.newClubChanges, 0, "a second run (another API process) finds nothing to do");
});

test("open invitations expire with the run", async () => {
  const { store, lifecycle } = setup();
  await store.change({ actorPlayerId: 1, targetPlayerId: 4 }, NOW - 8 * DAY_MS, () => ({
    ok: true,
    plan: [{ kind: "invite", clubId: 1, playerId: 4, invitedByPlayerId: 1, expiresAt: NOW - DAY_MS }],
    result: null,
  }));
  const report = await lifecycle.run();
  assert.equal(report.expiredInvitations, 1);
  assert.equal(store.invitations()[0]?.status, "expired");
  assert.ok(
    store.events.some((event) => event.type === "invitation.closed" && event.payload.invitation?.status === "expired"),
  );
});

test("absence (J5) runs only after go-live and only with a fresh member list", async () => {
  const before = setup({ goLive: false, present: [1, 3] });
  assert.equal((await before.lifecycle.run()).absenceSkipped, "not live yet");
  const stale = setup({ present: [1, 3], snapshotAge: 31 * 60 * 1000 });
  assert.equal((await stale.lifecycle.run()).absenceSkipped, "no fresh member list");
  const { store, lifecycle, clock } = setup({ present: [1, 3] });
  const report = await lifecycle.run();
  assert.equal(report.absenceSkipped, "");
  assert.equal(report.absenceChanges, 1, "player 2 stamped");
  clock.now = NOW + 14 * DAY_MS;
  await lifecycle.run();
  assert.equal(store.memberClub(2), null, "removed after 14 days");
  assert.ok(store.events.some((event) => event.type === "member.left" && event.payload.reason === "absent"));
});

test("absenceDue: who the absence rule changes", () => {
  const member = {
    playerId: 1,
    discordId: "1",
    name: "",
    country: "",
    isOfficer: false,
    joinedAt: null,
    absentSince: null,
    absenceExempt: false,
  };
  assert.equal(absenceDue(member, true, NOW), false);
  assert.equal(absenceDue({ ...member, absentSince: NOW - DAY_MS }, true, NOW), true, "back on the server");
  assert.equal(absenceDue(member, false, NOW), true, "newly absent");
  assert.equal(absenceDue({ ...member, absentSince: NOW - DAY_MS }, false, NOW), false, "stamped, waiting");
  assert.equal(absenceDue({ ...member, absentSince: NOW - 14 * DAY_MS }, false, NOW), true, "14 days over");
  assert.equal(absenceDue({ ...member, absenceExempt: true }, false, NOW), false, "exempt from go-live");
});
