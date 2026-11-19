import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { clubNameKey } from "@ms/shared/clubs";
import { createMemoryClubStore, type MemoryClubStore } from "../../fixtures/club-store.ts";
import type { GuildMemberSnapshot, SnapshotMember } from "../../integrations/discord/guild-members.ts";
import type { GuildMember } from "../../integrations/discord/members.ts";
import type { DiscordIdentity } from "../profile/mappers.ts";
import { createClubManagement, type ClubOutcome, type ClubRequest } from "./management.ts";
import { DAY_MS } from "./rules.ts";

const NOW = Date.parse("2026-12-01T12:00:00.000Z");
const ADMIN_ROLE = "271232737917140992";

const SETTINGS = { is_open: true, regions: ["EU"], club_codes: ["ABC1234"] };

/**
 * Club 5 "Hammer Bros" [HB], open: captain Cap (1), officer Olga (2), member Zed (4). Club-less: New (8), Ivy (9),
 * Gone (10, not on the server), Adam (11, an admin). Everyone on the server joined 400 days ago.
 */
function world(options: { mode?: "off" | "admins" | "on"; discordDown?: boolean } = {}) {
  const clock = { now: NOW };
  const discordId = (playerId: number): string => `1000000000000000${String(playerId).padStart(2, "0")}`;
  const names: Record<number, string> = { 1: "Cap", 2: "Olga", 4: "Zed", 8: "New", 9: "Ivy", 10: "Gone", 11: "Adam" };
  const store: MemoryClubStore = createMemoryClubStore({
    keyOf: clubNameKey,
    mode: { mode: options.mode ?? "on", goLiveAt: null },
    clubs: [
      {
        clubId: 5,
        publicId: "Ab3dEf9h",
        name: "Hammer Bros",
        tag: "HB",
        ownerDiscordId: discordId(1),
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
        activity: NOW - DAY_MS,
      },
    ],
    players: Object.entries(names).map(([id, name]) => ({
      playerId: Number(id),
      discordId: discordId(Number(id)),
      name,
      country: "de",
    })),
  });
  store.addMember(5, 1, { isOfficer: true });
  store.addMember(5, 2, { isOfficer: true });
  store.addMember(5, 4);
  const listed = (playerId: number, roles: string[] = []): [string, SnapshotMember] => [
    discordId(playerId),
    {
      id: discordId(playerId),
      username: names[playerId]?.toLowerCase() ?? "",
      globalName: names[playerId] ?? "",
      nick: "",
      roles,
      joinedAt: NOW - 400 * DAY_MS,
    },
  ];
  const snapshot: GuildMemberSnapshot = {
    takenAt: NOW,
    members: new Map([listed(1), listed(2), listed(4), listed(8), listed(9), listed(11, [ADMIN_ROLE])]),
  };
  const changes: string[] = [];
  const clubs = createClubManagement({
    store,
    members: {
      getMember: (id): Promise<GuildMember> => {
        if (options.discordDown)
          return Promise.resolve({ membership: "unknown", nick: "", username: "", globalName: "", roles: [] });
        const member = snapshot.members.get(id);
        return Promise.resolve(
          member
            ? {
                membership: "member",
                nick: "",
                username: member.username,
                globalName: member.globalName,
                roles: member.roles,
                joinedAt: member.joinedAt ?? 0,
              }
            : { membership: "not_member", nick: "", username: "", globalName: "", roles: [] },
        );
      },
    },
    memberList: { get: () => Promise.resolve(snapshot) },
    ensurePlayer: (identity) => {
      const player = [...store.players.values()].find((entry) => entry.discordId === identity.id);
      if (!player) throw new Error(`no player for ${identity.id}`);
      return Promise.resolve({ playerId: player.playerId });
    },
    isAdmin: (cookie) => Promise.resolve(cookie === "admin"),
    adminRoleIds: [ADMIN_ROLE],
    logoUrl: (club) => Promise.resolve(club.logoUrl),
    now: () => clock.now,
    onChange: () => changes.push("change"),
  });
  const as = (playerId: number, cookie: unknown = "member"): ClubRequest => ({
    cookie,
    identity: {
      id: discordId(playerId),
      username: names[playerId] ?? "",
      globalName: "",
      nick: "",
    } satisfies DiscordIdentity,
  });
  return { store, clubs, as, clock, discordId, snapshot, changes };
}

function ok<T>(outcome: ClubOutcome<T>): T {
  if (outcome.kind !== "ok") assert.fail(`expected ok, got ${JSON.stringify(outcome)}`);
  return outcome.result;
}

function refused<T>(outcome: ClubOutcome<T>): string {
  if (outcome.kind !== "refused") assert.fail(`expected a refusal, got ${outcome.kind}`);
  return outcome.refusal.code;
}

test("My Club is closed in mode off, and in mode admins open to confirmed admins only", async () => {
  assert.equal((await world({ mode: "off" }).clubs.view(world().as(1))).kind, "closed");
  const testing = world({ mode: "admins" });
  assert.equal((await testing.clubs.view(testing.as(1))).kind, "closed");
  assert.equal((await testing.clubs.view(testing.as(1, "admin"))).kind, "ok");
  assert.equal(await testing.clubs.isOpen("admin"), true);
  assert.equal(await testing.clubs.isOpen("member"), false);
});

test("a change decides on the mode read under its own lock, not on the cached one", async () => {
  const { clubs, as, store, changes } = world();
  ok(await clubs.view(as(8)));
  store.mode = { mode: "off", goLiveAt: null };
  assert.equal((await clubs.join(as(8), 5)).kind, "closed", "switched off since the cached read");
  assert.equal(store.memberClub(8), null);
  assert.deepEqual(changes, []);

  const testing = world();
  ok(await testing.clubs.view(testing.as(11, "admin")));
  testing.store.mode = { mode: "admins", goLiveAt: null };
  assert.equal((await testing.clubs.join(testing.as(8), 5)).kind, "closed", "members wait for the go-live");
  assert.equal(refused(await testing.clubs.invite(testing.as(1, "admin"), 9)), "NOT_ALLOWED", "Ivy is no admin");
  ok(await testing.clubs.join(testing.as(11, "admin"), 5));
  assert.equal(testing.store.memberClub(11), 5);
});

test("every change checks the server live and fails closed when Discord cannot be asked", async () => {
  const { clubs, as, store } = world();
  assert.equal((await clubs.join(as(10), 5)).kind, "not_member", "Gone left the server");
  const down = world({ discordDown: true });
  assert.equal((await down.clubs.join(down.as(8), 5)).kind, "discord_unavailable");
  assert.equal(store.memberClub(8), null);
});

test("the view shows the role, the permissions, the roster in club order and the club codes", async () => {
  const { clubs, as } = world();
  const captain = ok(await clubs.view(as(1)));
  assert.equal(captain.club?.role, "captain");
  assert.equal(captain.club.permissions.deleteClub, true);
  assert.deepEqual(
    captain.club.members.map((member) => `${member.name}:${member.role}`),
    ["Cap:captain", "Olga:officer", "Zed:member"],
  );
  assert.deepEqual(captain.club.settings.clubCodes, ["ABC1234"]);
  const member = ok(await clubs.view(as(4)));
  assert.equal(member.club?.permissions.invite, false);
  assert.deepEqual(member.club.settings.clubCodes, ["ABC1234"], "F5: members always see the codes");
  assert.deepEqual(member.club.invitations, []);
  const loner = ok(await clubs.view(as(8)));
  assert.equal(loner.club, null);
  assert.equal(loner.create.allowed, true);
});

test("creating: validation, the creator becomes captain, names and tags are unique in any case", async () => {
  const { clubs, as, store } = world();
  const invalid = await clubs.create(as(8), { ...SETTINGS, name: "", tag: "mod" });
  assert.equal(invalid.kind, "invalid");
  const created = ok(await clubs.create(as(8), { ...SETTINGS, name: "  New   Club ", tag: "NEW" }));
  assert.equal(created.club?.name, "New Club");
  assert.equal(created.club.role, "captain");
  assert.equal(created.club.isActive, true, "a new club starts active");
  assert.notEqual(created.club.inactiveAt, null, "the new-club counter runs");
  assert.ok(store.events.some((event) => event.type === "club.created"));
  assert.ok(store.logs.some((entry) => entry.command === "WebsiteClubCreate"));
  assert.equal(refused(await clubs.create(as(9), { ...SETTINGS, name: "hammer bros", tag: "HB2" })), "NAME_TAKEN");
  assert.equal(refused(await clubs.create(as(9), { ...SETTINGS, name: "Other", tag: "hb" })), "TAG_TAKEN");
  assert.equal(refused(await clubs.create(as(4), { ...SETTINGS, name: "Mine", tag: "MINE" })), "ALREADY_IN_CLUB");
});

test("joining and leaving: the transfer post, the hour after leaving, the rejoin block after a removal", async () => {
  const { clubs, as, store, clock } = world();
  ok(await clubs.join(as(8), 5));
  const joined = store.events.find((event) => event.type === "member.joined");
  assert.equal(joined?.payload.transfer?.action, "joined");
  assert.deepEqual(joined.payload.club, { id: 5, name: "Hammer Bros", tag: "HB" });
  const left = ok(await clubs.leave(as(8)));
  assert.equal(left.club, null);
  assert.equal(left.joinCooldownUntil, NOW + 60 * 60 * 1000);
  assert.equal(refused(await clubs.join(as(8), 5)), "JOIN_COOLDOWN");
  clock.now += 60 * 60 * 1000;
  ok(await clubs.join(as(8), 5));
  const removed = ok(await clubs.removeMember(as(2), 8));
  assert.equal(
    removed.club?.members.some((member) => member.playerId === 8),
    false,
  );
  clock.now += 2 * 60 * 60 * 1000;
  assert.equal(refused(await clubs.join(as(8), 5)), "REJOIN_BLOCKED");
  assert.equal(ok(await clubs.view(as(8))).joinBlocks[0]?.clubId, 5);
});

test("invitations: the candidates, the invitation with its DM, and an answer by the bot's button", async () => {
  const { clubs, as, store, discordId } = world();
  const candidates = ok(await clubs.inviteCandidates(as(2), "", 1));
  assert.deepEqual(
    candidates.candidates.map((candidate) => candidate.name),
    ["Adam", "Ivy", "New"],
    "no club members, nobody off the server",
  );
  assert.deepEqual(
    ok(await clubs.inviteCandidates(as(2), "iv", 1)).candidates.map((candidate) => candidate.name),
    ["Ivy"],
  );
  assert.equal(refused(await clubs.inviteCandidates(as(4), "", 1)), "NOT_ALLOWED");
  assert.equal(refused(await clubs.invite(as(2), 10)), "PLAYER_NOT_ON_SERVER");

  const invited = ok(await clubs.invite(as(2), 9));
  assert.equal(invited.club?.invitations[0]?.name, "Ivy");
  const created = store.events.find((event) => event.type === "invitation.created");
  const invitationId = created?.payload.invitation?.id;
  assert.equal(typeof invitationId, "number", "the store fills in the new invitation's id");
  assert.deepEqual(created?.payload.dm, [{ discord_id: discordId(9), kind: "invitation" }]);
  assert.equal(ok(await clubs.inviteCandidates(as(2), "ivy", 1)).candidates[0]?.blockedUntil, NOW + 14 * DAY_MS);
  assert.equal(refused(await clubs.invite(as(1), 9)), "REINVITE_TOO_SOON");

  const answered = ok(await clubs.answerFromDiscord(discordId(9), Number(invitationId), true));
  assert.deepEqual(answered, { accepted: true, clubName: "Hammer Bros", clubTag: "HB" });
  assert.equal(store.memberClub(9), 5);
  assert.ok(
    store.events.some((event) => event.type === "invitation.closed" && event.payload.invitation?.status === "accepted"),
  );
  assert.equal(refused(await clubs.answerFromDiscord(discordId(9), Number(invitationId), true)), "INVITATION_CLOSED");
  assert.equal(
    refused(await clubs.answerFromDiscord(discordId(8), Number(invitationId), false)),
    "INVITATION_NOT_FOUND",
  );
});

test("in mode admins only admins can be invited, and only admins can answer a button", async () => {
  const { clubs, as, discordId, store } = world({ mode: "admins" });
  assert.equal(refused(await clubs.invite(as(1, "admin"), 9)), "NOT_ALLOWED");
  assert.deepEqual(
    ok(await clubs.inviteCandidates(as(1, "admin"), "", 1)).candidates.map((candidate) => candidate.name),
    ["Adam"],
  );
  ok(await clubs.invite(as(1, "admin"), 11));
  const invitationId = Number(
    store.events.find((event) => event.type === "invitation.created")?.payload.invitation?.id,
  );
  assert.equal((await clubs.answerFromDiscord(discordId(9), invitationId, true)).kind, "closed");
  assert.equal(ok(await clubs.answerFromDiscord(discordId(11), invitationId, false)).accepted, false);
});

test("settings: checked fields, the version they were loaded with, officers may save", async () => {
  const { clubs, as, store } = world();
  const view = ok(await clubs.view(as(2)));
  const version = view.club?.settingsVersion ?? "";
  const bad = await clubs.updateSettings(as(2), { ...SETTINGS, regions: [], version });
  assert.equal(bad.kind, "invalid");
  const saved = ok(await clubs.updateSettings(as(2), { ...SETTINGS, is_open: false, stadium: "planetoid", version }));
  assert.equal(saved.club?.settings.isOpen, false);
  assert.equal(saved.club.settings.stadium, "Planetoid");
  assert.equal(store.clubs.get(5)?.settings.isOpen, false);
  assert.equal(refused(await clubs.updateSettings(as(1), { ...SETTINGS, version })), "CLUB_CHANGED");
  assert.equal(
    refused(await clubs.updateSettings(as(4), { ...SETTINGS, version: saved.club.settingsVersion })),
    "NOT_ALLOWED",
  );
});

test("roles and the club's deletion through the service", async () => {
  const { clubs, as, store } = world();
  ok(await clubs.setOfficer(as(2), 4, true));
  assert.equal(refused(await clubs.setOfficer(as(2), 4, false)), "NOT_ALLOWED");
  ok(await clubs.setOfficer(as(4), 4, false));
  ok(await clubs.confirmActivity(as(2)));
  assert.equal(store.clubs.get(5)?.activity, NOW);
  assert.equal(refused(await clubs.deleteClub(as(1), "Hb")), "CONFIRMATION_MISMATCH");
  const after = ok(await clubs.deleteClub(as(1), "HB"));
  assert.equal(after.club, null);
  assert.equal(store.clubs.has(5), false);
  const deleted = store.events.find((event) => event.type === "club.deleted");
  assert.deepEqual(
    deleted?.payload.nick.map((entry) => entry.old_tag),
    ["HB", "HB", "HB"],
  );
  assert.equal(deleted.payload.dm.length, 2, "everyone but the captain who deleted it");
});

test("a change refreshes the public lists; a refused one does not", async () => {
  const { clubs, as, changes } = world();
  await clubs.join(as(4), 5);
  assert.deepEqual(changes, []);
  ok(await clubs.join(as(8), 5));
  assert.deepEqual(changes, ["change"]);
});

test("F6: officers upload a logo, it is shown with its hash and Club.Logo names its public URL; it can go again", async () => {
  const { clubs, as, store } = world();
  const png = await sharp({ create: { width: 600, height: 600, channels: 4, background: "#c33" } })
    .png()
    .toBuffer();
  assert.equal(refused(await clubs.uploadLogo(as(4), png)), "NOT_ALLOWED");
  assert.equal(refused(await clubs.uploadLogo(as(2), Buffer.from("GIF89a...."))), "LOGO_TYPE");
  const uploaded = ok(await clubs.uploadLogo(as(2), png));
  const logo = store.logos.get(5);
  assert.ok(logo);
  assert.deepEqual([logo.width, logo.height], [512, 512]);
  assert.equal(uploaded.club?.logo, "/api/clubs/msbl/5/logo?v=" + logo.hash);
  assert.equal(store.clubs.get(5)?.logoUrl, "https://mariostrikers.gg/api/clubs/msbl/5/logo?v=" + logo.hash);
  const removed = ok(await clubs.removeLogo(as(1)));
  assert.equal(removed.club?.logo, "");
  assert.equal(store.logos.has(5), false);
  assert.ok(store.logs.some((entry) => entry.command === "WebsiteClubLogoRemoved"));
});
