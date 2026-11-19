import assert from "node:assert/strict";
import test from "node:test";
import { CLUB_LIMITS, type ClubSettingsValue } from "@ms/shared/clubs";
import {
  DAY_MS,
  NEW_CLUB,
  createEligibility,
  decideAbsence,
  decideAdminDelete,
  decideAdminRemoveLogo,
  decideAdminRename,
  decideAnswer,
  decideConfirmActivity,
  decideCreate,
  decideDelete,
  decideExpiry,
  decideInvite,
  decideJoin,
  decideLeave,
  decideNewClubCounter,
  decideRemove,
  decideRevoke,
  decideSetOfficer,
  decideSettings,
  memberActionsOf,
  roleOf,
  settingsVersion,
  successorOf,
  type ClubMember,
  type ClubState,
  type Decision,
  type InvitationState,
  type LockedState,
  type PlanStep,
  type PlayerState,
} from "./rules.ts";

const NOW = Date.parse("2026-12-01T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

const SETTINGS: ClubSettingsValue = {
  isOpen: true,
  regions: ["EU"],
  clubCodes: ["ABC1234"],
  firstUniform: "",
  secondUniform: "",
  stadium: "",
  discordUrl: "",
};

function member(playerId: number, name: string, extra: Partial<ClubMember> = {}): ClubMember {
  return {
    playerId,
    discordId: `10${playerId}`,
    name,
    country: "de",
    isOfficer: false,
    joinedAt: null,
    absentSince: null,
    absenceExempt: false,
    ...extra,
  };
}

/** Club 5 "Hammer Bros" [HB]: captain Cap (1), officers Olga (2) and Bert (3), members Zed (4) and Anna (5). */
function club(extra: Partial<ClubState> = {}): ClubState {
  return {
    clubId: 5,
    publicId: "Ab3dEf9h",
    name: "Hammer Bros",
    tag: "HB",
    ownerDiscordId: "101",
    settings: SETTINGS,
    createdAt: NOW - 400 * DAY_MS,
    establishedAt: NOW - 300 * DAY_MS,
    streakSince: null,
    inactiveSince: null,
    inactiveWarnedAt: null,
    deletionWarnedAt: null,
    activity: null,
    members: [
      member(1, "Cap", { isOfficer: true }),
      member(2, "Olga", { isOfficer: true }),
      member(3, "Bert", { isOfficer: true }),
      member(4, "Zed"),
      member(5, "Anna"),
    ],
    ...extra,
  };
}

function player(playerId: number, extra: Partial<PlayerState> = {}): PlayerState {
  return {
    playerId,
    discordId: `10${playerId}`,
    name: `P${playerId}`,
    country: "",
    clubId: null,
    lastClubCreatedAt: null,
    lastClubExitAt: null,
    ...extra,
  };
}

function state(actor: PlayerState, extra: Partial<LockedState> = {}): LockedState {
  const own = club();
  return {
    now: NOW,
    actor,
    target: null,
    clubs: new Map([[own.clubId, own]]),
    invitations: [],
    joinBlocks: [],
    ...extra,
  };
}

function inClub(playerId: number, extra: Partial<LockedState> = {}): LockedState {
  return state(
    player(playerId, { clubId: 5, name: club().members.find((m) => m.playerId === playerId)?.name ?? "" }),
    extra,
  );
}

function plan<T>(decision: Decision<T>): readonly PlanStep[] {
  if (!decision.ok) assert.fail(`refused: ${decision.code} ${decision.message}`);
  return decision.plan;
}

function code<T>(decision: Decision<T>): string {
  return decision.ok ? "ok" : decision.code;
}

const kinds = (steps: readonly PlanStep[]): string[] =>
  steps.map((step) => (step.kind === "event" ? `event:${step.event.type}` : step.kind));

function nth(target: ClubState, index: number): ClubMember {
  const found = target.members[index];
  assert.ok(found);
  return found;
}

function eventOf(steps: readonly PlanStep[], type: string) {
  const step = steps.find((entry) => entry.kind === "event" && entry.event.type === type);
  return step?.kind === "event" ? step.event : undefined;
}

function invitation(id: number, extra: Partial<InvitationState> = {}): InvitationState {
  return {
    id,
    clubId: 5,
    playerId: 9,
    invitedByPlayerId: 1,
    status: "open",
    createdAt: NOW - DAY_MS,
    expiresAt: NOW + 6 * DAY_MS,
    ...extra,
  };
}

// ---------------------------------------------------------------------------------------------------
// Roles

test("the captain is the roster member whose Discord id is Club.Owner; officers count without the captain", () => {
  const hb = club();
  assert.equal(roleOf(hb, 1), "captain");
  assert.equal(roleOf(hb, 2), "officer");
  assert.equal(roleOf(hb, 4), "member");
  assert.equal(roleOf(hb, 99), null);
  assert.equal(roleOf(club({ ownerDiscordId: "" }), 1), "officer", "a club without owner has no captain");
  assert.deepEqual(memberActionsOf(hb, 2, member(4, "Zed")), { remove: true, promote: true, demote: false });
  assert.deepEqual(memberActionsOf(hb, 2, nth(hb, 2)), {
    remove: false,
    promote: false,
    demote: false,
  });
  assert.deepEqual(memberActionsOf(hb, 2, nth(hb, 1)), {
    remove: false,
    promote: false,
    demote: true,
  });
  assert.deepEqual(memberActionsOf(hb, 1, nth(hb, 2)), { remove: true, promote: false, demote: true });
});

test("promotions stop at three officers besides the captain", () => {
  const full = club({
    members: [...club().members.slice(0, 4), member(5, "Anna", { isOfficer: true }), member(6, "Ivy")],
  });
  const decision = decideSetOfficer(inClub(1, { clubs: new Map([[5, full]]) }), 6, true);
  assert.equal(code(decision), "OFFICER_LIMIT");
  const ok = plan(decideSetOfficer(inClub(2), 4, true));
  assert.deepEqual(kinds(ok), ["updateMember", "event:member.promoted", "log"]);
  assert.deepEqual(eventOf(ok, "member.promoted")?.payload.dm, [{ discord_id: "104", kind: "promoted" }]);
  assert.equal(code(decideSetOfficer(inClub(4), 5, true)), "NOT_ALLOWED", "a member cannot promote");
  assert.equal(code(decideSetOfficer(inClub(2), 3, true)), "ALREADY_OFFICER");
});

test("only the captain demotes another officer; an officer drops only their own role", () => {
  assert.equal(code(decideSetOfficer(inClub(2), 3, false)), "NOT_ALLOWED");
  const own = plan(decideSetOfficer(inClub(2), 2, false));
  assert.deepEqual(eventOf(own, "member.demoted")?.payload.dm, [], "no DM to oneself");
  const captain = plan(decideSetOfficer(inClub(1), 3, false));
  assert.deepEqual(eventOf(captain, "member.demoted")?.payload.dm, [{ discord_id: "103", kind: "demoted" }]);
  assert.equal(code(decideSetOfficer(inClub(1), 1, false)), "NOT_OFFICER", "the captain is not demoted");
});

test("officers remove normal members only; the captain removes anyone but themselves", () => {
  assert.equal(code(decideRemove(inClub(2), 3)), "NOT_ALLOWED");
  assert.equal(code(decideRemove(inClub(2), 1)), "NOT_ALLOWED");
  assert.equal(code(decideRemove(inClub(4), 5)), "NOT_ALLOWED");
  assert.equal(code(decideRemove(inClub(1), 1)), "CANNOT_TARGET_SELF");
  assert.equal(code(decideRemove(inClub(1), 42)), "TARGET_NOT_IN_CLUB");
  const steps = plan(decideRemove(inClub(1), 3));
  assert.deepEqual(kinds(steps), ["removeMember", "setPlayerState", "setJoinBlock", "event:member.removed", "log"]);
  const block = steps.find((step) => step.kind === "setJoinBlock");
  assert.equal(block?.kind === "setJoinBlock" && block.until, NOW + CLUB_LIMITS.rejoinBlockDays * DAY_MS);
  const removed = eventOf(steps, "member.removed");
  assert.deepEqual(removed?.payload.dm, [{ discord_id: "103", kind: "member_removed" }]);
  assert.deepEqual(removed.payload.nick, [{ discord_id: "103", old_tag: "HB" }]);
  assert.equal(removed.payload.transfer?.action, "removed");
});

// ---------------------------------------------------------------------------------------------------
// C1 creating

test("creating needs 14 days on the server, no club and 30 days since the last creation", () => {
  const fresh = player(7);
  assert.equal(createEligibility(fresh, NOW - 13 * DAY_MS, NOW).refusal?.code, "CREATE_TOO_NEW");
  assert.equal(createEligibility(fresh, NOW - 14 * DAY_MS, NOW).allowed, true);
  assert.equal(createEligibility(fresh, null, NOW).refusal?.code, "SERVER_AGE_UNKNOWN");
  assert.equal(createEligibility(player(7, { clubId: 3 }), NOW - 99 * DAY_MS, NOW).refusal?.code, "ALREADY_IN_CLUB");
  // The creation time survives the club: day 29 refused, day 30 allowed.
  assert.equal(
    createEligibility(player(7, { lastClubCreatedAt: NOW - 29 * DAY_MS }), 0, NOW).refusal?.code,
    "CREATE_COOLDOWN",
  );
  assert.equal(createEligibility(player(7, { lastClubCreatedAt: NOW - 30 * DAY_MS }), 0, NOW).allowed, true);
  const until = createEligibility(player(7, { lastClubCreatedAt: NOW - 29 * DAY_MS }), 0, NOW).refusal?.until;
  assert.equal(until, NOW + DAY_MS);
});

test("a new club: the creator is captain, the club starts active and its counter runs", () => {
  const input = { name: "New Club", tag: "NEW", settings: SETTINGS };
  const context = { guildJoinedAt: NOW - 100 * DAY_MS, publicId: "Zz8xWv7u", nameTaken: false, tagTaken: false };
  const steps = plan(decideCreate(state(player(7), { invitations: [invitation(3, { playerId: 7 })] }), input, context));
  assert.deepEqual(kinds(steps), [
    "createClub",
    "addMember",
    "setPlayerState",
    "closeInvitations",
    "event:invitation.closed",
    "event:club.created",
    "log",
  ]);
  const created = steps[0];
  assert.ok(created?.kind === "createClub");
  assert.equal(created.club.ownerDiscordId, "107");
  assert.equal(created.club.activity, NOW, "L2: the creation counts as the first confirmation");
  assert.deepEqual(steps[1], { kind: "addMember", clubId: NEW_CLUB, playerId: 7, isOfficer: true });
  assert.equal(code(decideCreate(state(player(7)), input, { ...context, nameTaken: true })), "NAME_TAKEN");
  assert.equal(code(decideCreate(state(player(7)), input, { ...context, tagTaken: true })), "TAG_TAKEN");
});

// ---------------------------------------------------------------------------------------------------
// J1 joining, J2 invitations

test("joining: open clubs only, not within an hour of leaving, not while removed from that club", () => {
  const joiner = player(8);
  assert.equal(
    code(decideJoin(state(joiner, { clubs: new Map([[5, club({ settings: { ...SETTINGS, isOpen: false } })]]) }), 5)),
    "CLUB_INVITE_ONLY",
  );
  assert.equal(code(decideJoin(state(joiner), 77)), "CLUB_NOT_FOUND");
  assert.equal(code(decideJoin(state(player(8, { clubId: 3 })), 5)), "ALREADY_IN_CLUB");
  const left = player(8, { lastClubExitAt: NOW - 59 * 60 * 1000 });
  const cooldown = decideJoin(state(left), 5);
  assert.equal(code(cooldown), "JOIN_COOLDOWN");
  assert.equal(!cooldown.ok && cooldown.until, NOW + 60 * 1000);
  assert.equal(code(decideJoin(state(player(8, { lastClubExitAt: NOW - HOUR_MS })), 5)), "ok");
  const blocked = { clubId: 5, playerId: 8, until: NOW + DAY_MS };
  assert.equal(code(decideJoin(state(joiner, { joinBlocks: [blocked] }), 5)), "REJOIN_BLOCKED");
  assert.equal(code(decideJoin(state(joiner, { joinBlocks: [{ ...blocked, until: NOW }] }), 5)), "ok");
});

test("a join tells captain and officers, posts in #club-transfers, sets the tag and closes other invitations", () => {
  const steps = plan(
    decideJoin(state(player(8, { country: "fr" }), { invitations: [invitation(11, { playerId: 8, clubId: 6 })] }), 5),
  );
  const joined = eventOf(steps, "member.joined");
  assert.deepEqual(
    joined?.payload.dm.map((entry) => entry.discord_id),
    ["101", "102", "103"],
  );
  assert.deepEqual(joined.payload.transfer, { action: "joined", discord_id: "108", country: "fr" });
  assert.deepEqual(joined.payload.nick, [{ discord_id: "108", old_tag: "" }]);
  assert.ok(
    steps.some((step) => step.kind === "closeInvitations" && step.ids.includes(11) && step.status === "closed"),
  );
});

test("inviting: managers only, players without a club on the server, ten open, again after 14 days", () => {
  const target = player(9);
  assert.equal(code(decideInvite(inClub(4, { target }), { targetOnServer: true })), "NOT_ALLOWED");
  assert.equal(code(decideInvite(inClub(2, { target: null }), { targetOnServer: true })), "PLAYER_NOT_FOUND");
  assert.equal(
    code(decideInvite(inClub(2, { target: player(9, { clubId: 6 }) }), { targetOnServer: true })),
    "PLAYER_IN_CLUB",
  );
  assert.equal(code(decideInvite(inClub(2, { target }), { targetOnServer: false })), "PLAYER_NOT_ON_SERVER");
  const ten = Array.from({ length: 10 }, (_, index) => invitation(20 + index, { playerId: 30 + index }));
  assert.equal(
    code(decideInvite(inClub(2, { target, invitations: ten }), { targetOnServer: true })),
    "INVITATION_LIMIT",
  );
  const earlier = invitation(40, { status: "declined", createdAt: NOW - 13 * DAY_MS });
  const tooSoon = decideInvite(inClub(2, { target, invitations: [earlier] }), { targetOnServer: true });
  assert.equal(code(tooSoon), "REINVITE_TOO_SOON");
  assert.equal(!tooSoon.ok && tooSoon.until, NOW + DAY_MS);
  const later = { ...earlier, createdAt: NOW - 14 * DAY_MS };
  const steps = plan(decideInvite(inClub(2, { target, invitations: [later] }), { targetOnServer: true }));
  assert.deepEqual(kinds(steps), ["liftJoinBlock", "invite", "event:invitation.created", "log"]);
  const invite = steps[1];
  assert.equal(invite?.kind === "invite" && invite.expiresAt, NOW + 7 * DAY_MS);
  const created = eventOf(steps, "invitation.created");
  assert.equal(created?.newInvitation, true);
  assert.deepEqual(created.payload.dm, [{ discord_id: "109", kind: "invitation" }]);
});

test("accepting re-checks everything and ignores the hour after leaving; declining and revoking close it", () => {
  const open = invitation(12, { playerId: 9 });
  const invitee = player(9, { lastClubExitAt: NOW - 10 * 60 * 1000 });
  const accepted = plan(
    decideAnswer(state(invitee, { invitations: [open, invitation(13, { playerId: 9, clubId: 6 })] }), 12, true),
  );
  assert.ok(
    accepted.some((step) => step.kind === "closeInvitations" && step.ids.includes(12) && step.status === "accepted"),
  );
  assert.ok(
    accepted.some((step) => step.kind === "closeInvitations" && step.ids.includes(13) && step.status === "closed"),
  );
  assert.equal(eventOf(accepted, "member.joined")?.payload.reason, "invitation");
  assert.equal(
    code(decideAnswer(state(player(9, { clubId: 6 }), { invitations: [open] }), 12, true)),
    "ALREADY_IN_CLUB",
  );
  assert.equal(
    code(decideAnswer(state(invitee, { invitations: [{ ...open, expiresAt: NOW }] }), 12, true)),
    "INVITATION_CLOSED",
  );
  assert.equal(
    code(decideAnswer(state(invitee, { invitations: [{ ...open, status: "revoked" }] }), 12, true)),
    "INVITATION_CLOSED",
  );
  assert.equal(code(decideAnswer(state(player(10), { invitations: [open] }), 12, true)), "INVITATION_NOT_FOUND");
  assert.equal(
    code(decideAnswer(state(invitee, { invitations: [open], clubs: new Map() }), 12, true)),
    "CLUB_NOT_FOUND",
  );
  const declined = plan(decideAnswer(state(player(9, { clubId: 6 }), { invitations: [open] }), 12, false));
  assert.deepEqual(kinds(declined), ["closeInvitations", "event:invitation.closed", "log"]);
  const revoked = plan(decideRevoke(inClub(2, { invitations: [open] }), 12));
  assert.ok(revoked.some((step) => step.kind === "closeInvitations" && step.status === "revoked"));
  assert.equal(code(decideRevoke(inClub(4, { invitations: [open] }), 12)), "NOT_ALLOWED");
});

test("open invitations expire after 7 days", () => {
  const steps = decideExpiry(
    NOW,
    [invitation(1, { expiresAt: NOW }), invitation(2), invitation(3, { status: "accepted", expiresAt: NOW - 1 })],
    () => club(),
  );
  assert.deepEqual(kinds(steps), ["closeInvitations", "event:invitation.closed"]);
  assert.ok(steps[0]?.kind === "closeInvitations" && steps[0].ids.length === 1 && steps[0].ids[0] === 1);
});

// ---------------------------------------------------------------------------------------------------
// Leaving and succession

const everyoneHere = (): boolean => true;

test("a member leaves: the hour starts, captain and officers are told, the tag goes", () => {
  const steps = plan(decideLeave(inClub(4), { isOnServer: everyoneHere }));
  assert.deepEqual(kinds(steps), ["removeMember", "setPlayerState", "event:member.left", "log"]);
  const left = eventOf(steps, "member.left");
  assert.deepEqual(
    left?.payload.dm.map((entry) => entry.discord_id),
    ["101", "102", "103"],
  );
  assert.deepEqual(left.payload.nick, [{ discord_id: "104", old_tag: "HB" }]);
  assert.equal(code(decideLeave(state(player(8)), { isOnServer: everyoneHere })), "NOT_IN_CLUB");
});

test("S1: the first officer A–Z takes over, skipping those off the server; without officers the first member", () => {
  const hb = club();
  assert.equal(successorOf(hb, new Set([1]), everyoneHere)?.name, "Bert");
  assert.equal(successorOf(hb, new Set([1]), (id) => id !== "103")?.name, "Olga", "Bert is not on the server");
  const noOfficers = club({ members: [member(1, "Cap", { isOfficer: true }), member(4, "Zed"), member(5, "Anna")] });
  assert.equal(successorOf(noOfficers, new Set([1]), everyoneHere)?.name, "Anna");
  assert.equal(successorOf(noOfficers, new Set([1]), () => false)?.name, "Anna", "nobody here: the first anyway");
  const steps = plan(decideLeave(inClub(1), { isOnServer: everyoneHere }));
  assert.ok(steps.some((step) => step.kind === "updateClub" && step.set.ownerDiscordId === "103"));
  assert.deepEqual(eventOf(steps, "captain.changed")?.payload.dm, [{ discord_id: "103", kind: "new_captain" }]);
  const left = eventOf(steps, "member.left");
  assert.deepEqual(
    left?.payload.dm.map((entry) => entry.discord_id),
    ["102", "103"],
    "the new captain and officers",
  );
});

test("S1 with only normal members makes the new captain an officer row; alone the club is deleted", () => {
  const two = club({ members: [member(1, "Cap", { isOfficer: true }), member(4, "Zed")] });
  const steps = plan(decideLeave(inClub(1, { clubs: new Map([[5, two]]) }), { isOnServer: everyoneHere }));
  assert.ok(steps.some((step) => step.kind === "updateMember" && step.playerId === 4 && step.set.isOfficer === true));
  const alone = club({ members: [member(1, "Cap", { isOfficer: true })] });
  const deleted = plan(decideLeave(inClub(1, { clubs: new Map([[5, alone]]) }), { isOnServer: everyoneHere }));
  assert.ok(deleted.some((step) => step.kind === "deleteClub" && step.clubId === 5));
  assert.equal(eventOf(deleted, "member.left")?.payload.dm.length, 0);
});

// ---------------------------------------------------------------------------------------------------
// Settings, activity, deletion

test("settings need a manager and the version they were loaded with; the same values always succeed", () => {
  const changed = { ...SETTINGS, isOpen: false };
  const version = settingsVersion(SETTINGS);
  assert.equal(code(decideSettings(inClub(4), changed, version)), "NOT_ALLOWED");
  assert.deepEqual(kinds(plan(decideSettings(inClub(2), changed, version))), ["updateClub", "log"]);
  assert.equal(code(decideSettings(inClub(2), changed, "old")), "CLUB_CHANGED");
  assert.deepEqual(plan(decideSettings(inClub(2), SETTINGS, "old")), [], "a double click");
  assert.deepEqual(kinds(plan(decideConfirmActivity(inClub(3)))), ["updateClub", "log"]);
  assert.equal(code(decideConfirmActivity(inClub(5))), "NOT_ALLOWED");
});

test("C2: only the captain deletes, with the exact tag; every member is told and loses the tag", () => {
  assert.equal(code(decideDelete(inClub(2), "HB")), "NOT_ALLOWED");
  assert.equal(code(decideDelete(inClub(1), "hb")), "CONFIRMATION_MISMATCH");
  const steps = plan(decideDelete(inClub(1, { invitations: [invitation(12)] }), "HB"));
  assert.deepEqual(kinds(steps), [
    "closeInvitations",
    "event:invitation.closed",
    "event:club.deleted",
    "deleteClub",
    "log",
  ]);
  const deleted = eventOf(steps, "club.deleted");
  assert.deepEqual(
    deleted?.payload.dm.map((entry) => entry.discord_id),
    ["102", "103", "104", "105"],
    "not the captain",
  );
  assert.deepEqual(
    deleted.payload.nick.map((entry) => entry.old_tag),
    ["HB", "HB", "HB", "HB", "HB"],
  );
});

// ---------------------------------------------------------------------------------------------------
// L1 new clubs, J5 absence

function newClub(ageDays: number, extra: Partial<ClubState> = {}): ClubState {
  return club({
    createdAt: NOW - ageDays * DAY_MS,
    establishedAt: null,
    members: [member(1, "Cap", { isOfficer: true })],
    ...extra,
  });
}

const counter = (target: ClubState): readonly PlanStep[] => decideNewClubCounter({ now: NOW, invitations: [] }, target);

test("L1: alone for 30 days the club is marked inactive, 14 days later deleted, with warnings before both", () => {
  assert.deepEqual(counter(newClub(22)), []);
  assert.deepEqual(kinds(counter(newClub(23))), ["updateClub", "event:club.inactivity_warning"]);
  assert.deepEqual(counter(newClub(24, { inactiveWarnedAt: NOW - DAY_MS })), [], "warned once");
  const marked = counter(newClub(30, { inactiveWarnedAt: NOW - 7 * DAY_MS }));
  assert.deepEqual(kinds(marked), ["updateClub", "event:club.marked_inactive"]);
  assert.equal(eventOf(marked, "club.marked_inactive")?.payload.deletion_at, new Date(NOW + 14 * DAY_MS).toISOString());
  assert.deepEqual(kinds(counter(newClub(41, { inactiveSince: NOW - 11 * DAY_MS }))), [
    "updateClub",
    "event:club.deletion_warning",
  ]);
  assert.deepEqual(counter(newClub(42, { inactiveSince: NOW - 12 * DAY_MS, deletionWarnedAt: NOW - DAY_MS })), []);
  const deleted = counter(newClub(44, { inactiveSince: NOW - 14 * DAY_MS }));
  assert.ok(deleted.some((step) => step.kind === "deleteClub"));
  assert.equal(eventOf(deleted, "club.deleted")?.payload.reason, "inactive new club");
});

test("L1: a 7-day streak of two members establishes the club; a running streak postpones the counter", () => {
  const pair = [member(1, "Cap", { isOfficer: true }), member(6, "Ivy")];
  assert.deepEqual(counter(newClub(35, { members: pair, streakSince: NOW - 6 * DAY_MS })), [], "6 days: still running");
  const established = counter(
    newClub(35, { members: pair, streakSince: NOW - 7 * DAY_MS, inactiveSince: NOW - 5 * DAY_MS }),
  );
  assert.ok(
    established[0]?.kind === "updateClub" &&
      established[0].set.establishedAt === NOW &&
      established[0].set.inactiveSince === null,
  );
  assert.deepEqual(
    counter(newClub(50, { members: pair, streakSince: NOW - DAY_MS, inactiveSince: NOW - 20 * DAY_MS })),
    [],
    "day 44 passed, streak running",
  );
  assert.deepEqual(counter(club()), [], "established clubs are never counted");
});

test("membership changes keep the streak: a second member starts it, going below two ends it", () => {
  const alone = newClub(5);
  const joined = plan(decideJoin(state(player(8), { clubs: new Map([[5, alone]]) }), 5));
  assert.ok(joined.some((step) => step.kind === "updateClub" && step.set.streakSince === NOW));
  const pair = newClub(5, {
    members: [member(1, "Cap", { isOfficer: true }), member(6, "Ivy")],
    streakSince: NOW - 2 * DAY_MS,
  });
  const left = plan(
    decideLeave(state(player(6, { clubId: 5 }), { clubs: new Map([[5, pair]]) }), { isOnServer: everyoneHere }),
  );
  assert.ok(left.some((step) => step.kind === "updateClub" && step.set.streakSince === null));
  const establishedJoin = plan(decideJoin(state(player(8)), 5));
  assert.equal(
    establishedJoin.some((step) => step.kind === "updateClub"),
    false,
    "established clubs keep no streak",
  );
});

test("J5: absent members are stamped, come back clean, and are removed after 14 days like a leave", () => {
  const hb = club({
    members: [
      member(1, "Cap", { isOfficer: true }),
      member(2, "Olga", { isOfficer: true, absentSince: NOW - 3 * DAY_MS }),
      member(4, "Zed", { absentSince: NOW - 14 * DAY_MS }),
      member(5, "Anna", { absenceExempt: true }),
      member(6, "Ivy"),
    ],
  });
  const away = new Set(["104", "105", "106"]);
  const steps = decideAbsence({ now: NOW, invitations: [] }, hb, (id) => !away.has(id));
  assert.ok(
    steps.some((step) => step.kind === "updateMember" && step.playerId === 2 && step.set.absentSince === null),
    "Olga is back",
  );
  assert.ok(
    steps.some((step) => step.kind === "updateMember" && step.playerId === 6 && step.set.absentSince === NOW),
    "Ivy stamped",
  );
  assert.equal(
    steps.some((step) => "playerId" in step && step.playerId === 5),
    false,
    "Anna is exempt from go-live",
  );
  const left = eventOf(steps, "member.left");
  assert.equal(left?.payload.reason, "absent");
  assert.equal(left.payload.target?.player_id, 4);
  assert.ok(steps.some((step) => step.kind === "removeMember" && step.playerId === 4));
});

test("J5 for an absent captain runs S1; for everyone absent the club is deleted", () => {
  const hb = club({
    members: [
      member(1, "Cap", { isOfficer: true, absentSince: NOW - 15 * DAY_MS }),
      member(2, "Olga", { isOfficer: true }),
      member(4, "Zed"),
    ],
  });
  const steps = decideAbsence({ now: NOW, invitations: [] }, hb, (id) => id !== "101");
  assert.ok(steps.some((step) => step.kind === "updateClub" && step.set.ownerDiscordId === "102"));
  assert.deepEqual(eventOf(steps, "captain.changed")?.payload.dm, [{ discord_id: "102", kind: "new_captain" }]);
  const ghost = club({ members: [member(1, "Cap", { isOfficer: true, absentSince: NOW - 20 * DAY_MS })] });
  assert.ok(
    decideAbsence({ now: NOW, invitations: [] }, ghost, () => false).some((step) => step.kind === "deleteClub"),
  );
});

test("B2: an admin renames any club; the members' nicknames follow a new tag; a taken name or tag is refused", () => {
  const admin = player(42, { discordId: "10042" });
  const free = { nameTaken: false, tagTaken: false };
  assert.deepEqual(plan(decideAdminRename(state(admin), 5, { name: "Hammer Bros", tag: "HB" }, free)), [], "unchanged");
  assert.equal(code(decideAdminRename(state(admin), 9, { name: "X", tag: "X" }, free)), "CLUB_NOT_FOUND");
  assert.equal(
    code(decideAdminRename(state(admin), 5, { name: "Taken", tag: "HB" }, { ...free, nameTaken: true })),
    "NAME_TAKEN",
  );
  assert.equal(
    code(decideAdminRename(state(admin), 5, { name: "Hammer Bros", tag: "TK" }, { ...free, tagTaken: true })),
    "TAG_TAKEN",
  );

  const renamed = plan(decideAdminRename(state(admin), 5, { name: "Hammer Brothers", tag: "HB" }, free));
  assert.deepEqual(kinds(renamed), ["updateClub", "event:club.renamed", "log"]);
  assert.deepEqual(renamed[0]?.kind === "updateClub" ? renamed[0].set : null, { name: "Hammer Brothers" });
  assert.deepEqual(eventOf(renamed, "club.renamed")?.payload.nick, [], "the tag stays, so do the nicknames");

  const retagged = plan(decideAdminRename(state(admin), 5, { name: "Hammer Bros", tag: "HBR" }, free));
  const event = eventOf(retagged, "club.renamed");
  assert.ok(event);
  assert.equal(event.clubTag, "HBR");
  assert.deepEqual(
    event.payload.nick.map((entry) => entry.old_tag),
    ["HB", "HB", "HB", "HB", "HB"],
  );
  assert.deepEqual(event.payload.dm, [], "no DMs for a rename");
});

test("B2: an admin removes a club's logo or deletes the club with its exact tag; every member is told", () => {
  const admin = player(42, { discordId: "10042" });
  assert.deepEqual(kinds(plan(decideAdminRemoveLogo(state(admin), 5))), ["removeLogo", "updateClub", "log"]);
  assert.equal(code(decideAdminDelete(state(admin), 5, "hb")), "CONFIRMATION_MISMATCH");
  const deleted = plan(decideAdminDelete(state(admin), 5, "HB"));
  const event = eventOf(deleted, "club.deleted");
  assert.ok(event);
  assert.equal(event.payload.reason, "deleted by an admin");
  assert.deepEqual(
    event.payload.dm.map((entry) => entry.discord_id),
    ["101", "102", "103", "104", "105"],
  );
  assert.ok(kinds(deleted).includes("deleteClub"));
});
