// The rules of club management (docs/adr/0012), once: pure decisions on the state of the clubs a change touches,
// read under locks by the store (management-repository.ts). Each decision answers with a plan (the writes, in
// order, and the events for the bot) or a refusal; the store applies the plan in the same transaction. Nothing here
// reads the clock, the database or Discord; the service passes in what it needs.

import { createHash, randomInt } from "node:crypto";
import {
  CLUB_LIMITS,
  CLUB_PUBLIC_ID_ALPHABET,
  CLUB_PUBLIC_ID_LENGTH,
  type ClubSettingsValue,
  type NewClubValue,
} from "@ms/shared/clubs";
import {
  dmTo,
  emptyPayload,
  type ClubDmKind,
  type ClubEventPayload,
  type ClubEventType,
  type EventPerson,
} from "./events.ts";
import { compareRosterRows } from "./mappers.ts";

export const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** F1: a new club id, eight random characters of the alphabet (unique by the index; a collision draws again). */
export function generateClubPublicId(random: (max: number) => number = randomInt): string {
  let id = "";
  for (let index = 0; index < CLUB_PUBLIC_ID_LENGTH; index += 1) {
    id += CLUB_PUBLIC_ID_ALPHABET.charAt(random(CLUB_PUBLIC_ID_ALPHABET.length));
  }
  return id;
}

/** Lead times of the new-club counter's warnings (L1), before the inactive mark and before the deletion. */
export const L1_WARNING_DAYS = { inactive: 7, deletion: 3 } as const;

// ---------------------------------------------------------------------------------------------------
// The state a decision sees

export type ClubRole = "captain" | "officer" | "member";
export type InvitationStatus = "open" | "accepted" | "declined" | "revoked" | "expired" | "closed";

export interface ClubMember {
  readonly playerId: number;
  readonly discordId: string;
  readonly name: string;
  readonly country: string;
  /** dbo.ClubRoster.IsOfficer as stored; the captain's row usually has it too. */
  readonly isOfficer: boolean;
  readonly joinedAt: number | null;
  readonly absentSince: number | null;
  readonly absenceExempt: boolean;
}

export interface ClubState {
  readonly clubId: number;
  readonly publicId: string;
  readonly name: string;
  readonly tag: string;
  /** dbo.Club.Owner as a bare Discord id; "" for none. */
  readonly ownerDiscordId: string;
  readonly settings: ClubSettingsValue;
  readonly createdAt: number | null;
  readonly establishedAt: number | null;
  readonly streakSince: number | null;
  readonly inactiveSince: number | null;
  readonly inactiveWarnedAt: number | null;
  readonly deletionWarnedAt: number | null;
  readonly activity: number | null;
  readonly members: readonly ClubMember[];
}

export interface PlayerState {
  readonly playerId: number;
  readonly discordId: string;
  readonly name: string;
  readonly country: string;
  readonly clubId: number | null;
  readonly lastClubCreatedAt: number | null;
  readonly lastClubExitAt: number | null;
}

export interface InvitationState {
  readonly id: number;
  readonly clubId: number;
  readonly playerId: number;
  readonly invitedByPlayerId: number;
  readonly status: InvitationStatus;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface JoinBlockState {
  readonly clubId: number;
  readonly playerId: number;
  readonly until: number;
}

/** What the store read, under locks, for one change. */
export interface LockedState {
  readonly now: number;
  readonly actor: PlayerState;
  /** The other player of the change (invitee, member acted on); null when there is none or it does not exist. */
  readonly target: PlayerState | null;
  /** The clubs the change touches (the actor's, the one joined, the invitation's), with their members. */
  readonly clubs: ReadonlyMap<number, ClubState>;
  /** Invitations of these clubs (open, and of the last 14 days) and the open ones of the actor and target. */
  readonly invitations: readonly InvitationState[];
  readonly joinBlocks: readonly JoinBlockState[];
}

// ---------------------------------------------------------------------------------------------------
// The answer: a plan or a refusal

/** A club created earlier in the same plan. */
export const NEW_CLUB = { ref: "newClub" } as const;
/** An invitation created earlier in the same plan. */
export const NEW_INVITATION = { ref: "newInvitation" } as const;
export type ClubRef = number | typeof NEW_CLUB;

export interface ClubUpdate {
  readonly name?: string;
  readonly tag?: string;
  readonly ownerDiscordId?: string;
  readonly settings?: ClubSettingsValue;
  readonly logo?: string | null;
  readonly activity?: number;
  readonly establishedAt?: number | null;
  readonly streakSince?: number | null;
  readonly inactiveSince?: number | null;
  readonly inactiveWarnedAt?: number | null;
  readonly deletionWarnedAt?: number | null;
}

export interface NewClubRow {
  readonly publicId: string;
  readonly name: string;
  readonly tag: string;
  readonly ownerDiscordId: string;
  readonly settings: ClubSettingsValue;
  readonly createdAt: number;
  readonly activity: number;
}

/** A processed logo as dbo.ClubLogo stores it. */
export interface StoredLogo {
  readonly contentType: "image/webp";
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly hash: string;
}

export interface ClubEventDraft {
  readonly type: ClubEventType;
  readonly clubId: ClubRef;
  readonly clubPublicId: string;
  readonly clubName: string;
  readonly clubTag: string;
  readonly actorPlayerId: number | null;
  readonly targetPlayerId: number | null;
  /** Set for an event about an invitation created in the same plan. */
  readonly newInvitation?: boolean;
  readonly payload: ClubEventPayload;
}

export type PlanStep =
  | { readonly kind: "createClub"; readonly club: NewClubRow }
  | { readonly kind: "updateClub"; readonly clubId: number; readonly set: ClubUpdate }
  /** The club and everything attached to it: members, invitations, rejoin blocks, logo, lobby rows. */
  | { readonly kind: "deleteClub"; readonly clubId: number }
  | { readonly kind: "addMember"; readonly clubId: ClubRef; readonly playerId: number; readonly isOfficer: boolean }
  | {
      readonly kind: "updateMember";
      readonly playerId: number;
      readonly set: {
        readonly isOfficer?: boolean;
        readonly absentSince?: number | null;
        readonly absenceExempt?: boolean;
      };
    }
  | { readonly kind: "removeMember"; readonly playerId: number }
  | {
      readonly kind: "setPlayerState";
      readonly playerId: number;
      readonly set: { readonly lastClubCreatedAt?: number; readonly lastClubExitAt?: number };
    }
  | { readonly kind: "setJoinBlock"; readonly clubId: number; readonly playerId: number; readonly until: number }
  | { readonly kind: "liftJoinBlock"; readonly clubId: number; readonly playerId: number }
  | {
      readonly kind: "invite";
      readonly clubId: number;
      readonly playerId: number;
      readonly invitedByPlayerId: number;
      readonly expiresAt: number;
    }
  | { readonly kind: "closeInvitations"; readonly ids: readonly number[]; readonly status: InvitationStatus }
  /** F6: the processed logo (dbo.ClubLogo), replacing the club's previous one. */
  | { readonly kind: "setLogo"; readonly clubId: number; readonly logo: StoredLogo }
  | { readonly kind: "removeLogo"; readonly clubId: number }
  | { readonly kind: "event"; readonly event: ClubEventDraft }
  | { readonly kind: "log"; readonly command: string; readonly parameters: Readonly<Record<string, unknown>> };

export type ClubRefusalCode =
  | "NOT_IN_CLUB"
  | "ALREADY_IN_CLUB"
  | "NOT_ALLOWED"
  | "CLUB_NOT_FOUND"
  | "CLUB_INVITE_ONLY"
  | "JOIN_COOLDOWN"
  | "REJOIN_BLOCKED"
  | "TARGET_NOT_IN_CLUB"
  | "CANNOT_TARGET_SELF"
  | "ALREADY_OFFICER"
  | "NOT_OFFICER"
  | "OFFICER_LIMIT"
  | "PLAYER_NOT_FOUND"
  | "PLAYER_IN_CLUB"
  | "PLAYER_NOT_ON_SERVER"
  | "INVITATION_LIMIT"
  | "REINVITE_TOO_SOON"
  | "INVITATION_NOT_FOUND"
  | "INVITATION_CLOSED"
  | "SERVER_AGE_UNKNOWN"
  | "CREATE_TOO_NEW"
  | "CREATE_COOLDOWN"
  | "NAME_TAKEN"
  | "TAG_TAKEN"
  | "CONFIRMATION_MISMATCH"
  | "CLUB_CHANGED"
  | "LOGO_TYPE"
  | "LOGO_TOO_LARGE"
  | "LOGO_DIMENSIONS"
  | "LOGO_ANIMATED"
  | "LOGO_UNREADABLE";

export interface ClubRefusal {
  readonly ok: false;
  readonly code: ClubRefusalCode;
  readonly message: string;
  /** When a waiting time ends (cooldowns, blocks). */
  readonly until?: number;
}

export type Decision<T> = { readonly ok: true; readonly plan: readonly PlanStep[]; readonly result: T } | ClubRefusal;

export function refuse(code: ClubRefusalCode, message: string, until?: number): ClubRefusal {
  return until === undefined ? { ok: false, code, message } : { ok: false, code, message, until };
}

function done<T>(plan: readonly PlanStep[], result: T): Decision<T> {
  return { ok: true, plan, result };
}

// ---------------------------------------------------------------------------------------------------
// Roles and order

export function memberOf(club: ClubState, playerId: number): ClubMember | undefined {
  return club.members.find((member) => member.playerId === playerId);
}

export function isCaptain(club: ClubState, member: ClubMember): boolean {
  return club.ownerDiscordId !== "" && member.discordId === club.ownerDiscordId;
}

export function roleOf(club: ClubState, playerId: number): ClubRole | null {
  const member = memberOf(club, playerId);
  if (!member) return null;
  if (isCaptain(club, member)) return "captain";
  return member.isOfficer ? "officer" : "member";
}

export function captainOf(club: ClubState): ClubMember | undefined {
  return club.members.find((member) => isCaptain(club, member));
}

/** Officers besides the captain (P2: at most three). */
export function officersOf(club: ClubState): ClubMember[] {
  return club.members.filter((member) => member.isOfficer && !isCaptain(club, member));
}

/** The club list's order (the popup's): captain, officers A–Z, members A–Z. */
export function inClubOrder(club: ClubState, members: readonly ClubMember[] = club.members): ClubMember[] {
  return [...members].sort((a, b) =>
    compareRosterRows(
      { name: a.name, is_owner: isCaptain(club, a), is_officer: a.isOfficer, player_id: a.playerId },
      { name: b.name, is_owner: isCaptain(club, b), is_officer: b.isOfficer, player_id: b.playerId },
    ),
  );
}

/**
 * S1: who takes over from a captain who goes — the first officer in the club list, else the first member, skipping
 * everyone who is not on the server. When nobody left is on the server, the first in the order takes over anyway
 * (the absence rule removes them later), so the club keeps a captain; null when nobody is left.
 */
export function successorOf(
  club: ClubState,
  leaving: ReadonlySet<number>,
  isOnServer: (discordId: string) => boolean,
): ClubMember | null {
  const candidates = inClubOrder(
    club,
    club.members.filter((member) => !leaving.has(member.playerId) && !isCaptain(club, member)),
  );
  return candidates.find((member) => isOnServer(member.discordId)) ?? candidates[0] ?? null;
}

export interface ClubPermissions {
  readonly invite: boolean;
  readonly editSettings: boolean;
  readonly confirmActivity: boolean;
  readonly promote: boolean;
  readonly deleteClub: boolean;
  readonly leave: boolean;
}

export function permissionsOf(role: ClubRole | null): ClubPermissions {
  const manager = role === "captain" || role === "officer";
  return {
    invite: manager,
    editSettings: manager,
    confirmActivity: manager,
    promote: manager,
    deleteClub: role === "captain",
    leave: role !== null,
  };
}

/** What the actor may do to one member (P1–P3); the page shows only these buttons. */
export function memberActionsOf(
  club: ClubState,
  actorPlayerId: number,
  member: ClubMember,
): { readonly remove: boolean; readonly promote: boolean; readonly demote: boolean } {
  const actorRole = roleOf(club, actorPlayerId);
  const targetRole = roleOf(club, member.playerId);
  const self = member.playerId === actorPlayerId;
  const manager = actorRole === "captain" || actorRole === "officer";
  return {
    remove:
      !self &&
      targetRole !== "captain" &&
      (actorRole === "captain" || (actorRole === "officer" && targetRole === "member")),
    promote: manager && targetRole === "member" && officersOf(club).length < CLUB_LIMITS.maxOfficers,
    demote: targetRole === "officer" && (actorRole === "captain" || (actorRole === "officer" && self)),
  };
}

// ---------------------------------------------------------------------------------------------------
// Plan helpers

function person(member: { playerId: number; discordId: string; name: string; country: string }): EventPerson {
  return { player_id: member.playerId, discord_id: member.discordId, name: member.name, country: member.country };
}

function event(
  type: ClubEventType,
  club: { clubId: ClubRef; publicId: string; name: string; tag: string },
  payload: Partial<ClubEventPayload>,
  ids: { actor?: number | null; target?: number | null; newInvitation?: boolean } = {},
): PlanStep {
  return {
    kind: "event",
    event: {
      type,
      clubId: club.clubId,
      clubPublicId: club.publicId,
      clubName: club.name,
      clubTag: club.tag,
      actorPlayerId: ids.actor ?? null,
      targetPlayerId: ids.target ?? null,
      ...(ids.newInvitation ? { newInvitation: true } : {}),
      payload: { ...emptyPayload(club), ...payload },
    },
  };
}

function log(command: string, parameters: Record<string, unknown>): PlanStep {
  return { kind: "log", command, parameters };
}

const iso = (ms: number): string => new Date(ms).toISOString();

type ClubLabel = Pick<ClubState, "publicId" | "name" | "tag">;

/** The event that takes the buttons off an invitation's DM; `club` is the invitation's club when it is known. */
function invitationClosedEvent(
  club: ClubLabel | undefined,
  invitation: InvitationState,
  status: InvitationStatus,
): PlanStep {
  return event(
    "invitation.closed",
    { clubId: invitation.clubId, publicId: club?.publicId ?? "", name: club?.name ?? "", tag: club?.tag ?? "" },
    { invitation: { id: invitation.id, status, expires_at: iso(invitation.expiresAt), invited_by: "" } },
    { target: invitation.playerId },
  );
}

/** Closes invitations with one step and one DM-editing event each. */
function closeInvitations(
  invitations: readonly InvitationState[],
  status: InvitationStatus,
  clubOf: (clubId: number) => ClubLabel | undefined,
): PlanStep[] {
  if (!invitations.length) return [];
  return [
    { kind: "closeInvitations", ids: invitations.map((invitation) => invitation.id), status },
    ...invitations.map((invitation) => invitationClosedEvent(clubOf(invitation.clubId), invitation, status)),
  ];
}

/** The open invitations of a player, closed silently (their DMs lose the buttons). */
function closePlayersInvitations(
  state: LockedState,
  playerId: number,
  status: InvitationStatus,
  except?: number,
): PlanStep[] {
  const open = state.invitations.filter(
    (invitation) => invitation.playerId === playerId && invitation.status === "open" && invitation.id !== except,
  );
  return closeInvitations(open, status, (clubId) => state.clubs.get(clubId));
}

/** L1's two-member streak follows the member count of a club the counter still runs for. */
function streakUpdate(club: ClubState, membersAfter: number, now: number): ClubUpdate {
  if (club.establishedAt !== null) return {};
  if (membersAfter >= 2 && club.streakSince === null) return { streakSince: now };
  if (membersAfter < 2 && club.streakSince !== null) return { streakSince: null };
  return {};
}

function updateClub(clubId: number, set: ClubUpdate): PlanStep[] {
  return Object.keys(set).length ? [{ kind: "updateClub", clubId, set }] : [];
}

/** The captain and officers after a change, as DM recipients. */
function managersAfter(club: ClubState, removed: ReadonlySet<number>, newCaptain: ClubMember | null): string[] {
  const captain = newCaptain ?? captainOf(club);
  return club.members
    .filter(
      (member) =>
        !removed.has(member.playerId) && (member === captain || (member.isOfficer && !isCaptain(club, member))),
    )
    .map((member) => member.discordId);
}

/**
 * C2 and every deletion: the club with everything attached; members club-less (DM to each, nickname tags off),
 * open invitations closed, a CommandLog line. `except`: the member who deleted it sees the result on the page.
 */
export function deletionPlan(
  state: Pick<LockedState, "invitations">,
  club: ClubState,
  reason: string,
  options: { readonly actor?: PlayerState | null; readonly by: string; readonly notify?: boolean },
): PlanStep[] {
  const open = state.invitations.filter(
    (invitation) => invitation.clubId === club.clubId && invitation.status === "open",
  );
  const actorId = options.actor?.discordId ?? "";
  return [
    ...closeInvitations(open, "closed", () => club),
    event(
      "club.deleted",
      { clubId: club.clubId, publicId: club.publicId, name: club.name, tag: club.tag },
      {
        actor: options.actor ? person(options.actor) : null,
        dm:
          options.notify === false
            ? []
            : dmTo(
                club.members.map((member) => member.discordId),
                "club_deleted",
                [actorId],
              ),
        nick: club.members.map((member) => ({ discord_id: member.discordId, old_tag: club.tag })),
        reason,
      },
      { actor: options.actor?.playerId ?? null },
    ),
    { kind: "deleteClub", clubId: club.clubId },
    log("WebsiteClubDelete", {
      club_id: club.clubId,
      public_id: club.publicId,
      tag: club.tag,
      name: club.name,
      members: club.members.length,
      reason,
      by: options.by,
    }),
  ];
}

/**
 * A member goes (left, removed, absent): the roster row, the 1-hour wait (J3), the streak, and — when it was the
 * captain — the successor (S1) or, with nobody left, the club's deletion.
 */
function departurePlan(
  state: LockedState,
  club: ClubState,
  member: ClubMember,
  isOnServer: (discordId: string) => boolean,
): { readonly steps: PlanStep[]; readonly newCaptain: ClubMember | null; readonly deleted: boolean } {
  const steps: PlanStep[] = [
    { kind: "removeMember", playerId: member.playerId },
    { kind: "setPlayerState", playerId: member.playerId, set: { lastClubExitAt: state.now } },
  ];
  const remaining = club.members.length - 1;
  if (remaining === 0) {
    return {
      steps: [...steps, ...deletionPlan(state, { ...club, members: [] }, "the last member left", { by: "website" })],
      newCaptain: null,
      deleted: true,
    };
  }
  let newCaptain: ClubMember | null = null;
  const set: { ownerDiscordId?: string } = {};
  if (isCaptain(club, member)) {
    newCaptain = successorOf(club, new Set([member.playerId]), isOnServer);
    if (newCaptain) {
      set.ownerDiscordId = newCaptain.discordId;
      if (!newCaptain.isOfficer)
        steps.push({ kind: "updateMember", playerId: newCaptain.playerId, set: { isOfficer: true } });
      steps.push(
        event(
          "captain.changed",
          { clubId: club.clubId, publicId: club.publicId, name: club.name, tag: club.tag },
          { target: person(newCaptain), dm: dmTo([newCaptain.discordId], "new_captain"), reason: "succession" },
          { target: newCaptain.playerId },
        ),
      );
    }
  }
  steps.push(...updateClub(club.clubId, { ...set, ...streakUpdate(club, remaining, state.now) }));
  return { steps, newCaptain, deleted: false };
}

function joinPlan(state: LockedState, club: ClubState, via: "join" | "invitation", invitationId?: number): PlanStep[] {
  const { actor } = state;
  return [
    { kind: "addMember", clubId: club.clubId, playerId: actor.playerId, isOfficer: false },
    { kind: "liftJoinBlock", clubId: club.clubId, playerId: actor.playerId },
    ...updateClub(club.clubId, streakUpdate(club, club.members.length + 1, state.now)),
    ...(invitationId === undefined
      ? closePlayersInvitations(state, actor.playerId, "closed")
      : [
          { kind: "closeInvitations" as const, ids: [invitationId], status: "accepted" as const },
          ...closePlayersInvitations(state, actor.playerId, "closed", invitationId),
        ]),
    event(
      "member.joined",
      { clubId: club.clubId, publicId: club.publicId, name: club.name, tag: club.tag },
      {
        target: person(actor),
        dm: dmTo(managersAfter(club, new Set(), null), "member_joined", [actor.discordId]),
        nick: [{ discord_id: actor.discordId, old_tag: "" }],
        transfer: { action: "joined", discord_id: actor.discordId, country: actor.country },
        reason: via,
      },
      { actor: actor.playerId, target: actor.playerId },
    ),
    log(via === "join" ? "WebsiteClubJoin" : "WebsiteClubAccept", {
      club_id: club.clubId,
      player_id: actor.playerId,
      discord_id: actor.discordId,
      ...(invitationId === undefined ? {} : { invitation_id: invitationId }),
    }),
  ];
}

function actorsClub(state: LockedState): ClubState | ClubRefusal {
  const club = state.actor.clubId === null ? undefined : state.clubs.get(state.actor.clubId);
  return club ?? refuse("NOT_IN_CLUB", "You are not in a club.");
}

function managersClub(state: LockedState): ClubState | ClubRefusal {
  const club = actorsClub(state);
  if ("ok" in club) return club;
  const role = roleOf(club, state.actor.playerId);
  return role === "captain" || role === "officer"
    ? club
    : refuse("NOT_ALLOWED", "Only the captain and the officers can do this.");
}

// ---------------------------------------------------------------------------------------------------
// C1 creating

export interface CreateEligibility {
  readonly allowed: boolean;
  readonly refusal: ClubRefusal | null;
}

/** C1 without the name: on the server for 14 days, in no club, 30 days since the last creation. */
export function createEligibility(player: PlayerState, guildJoinedAt: number | null, now: number): CreateEligibility {
  const no = (refusal: ClubRefusal): CreateEligibility => ({ allowed: false, refusal });
  if (player.clubId !== null) return no(refuse("ALREADY_IN_CLUB", "Leave your club before you create one."));
  if (guildJoinedAt === null) {
    return no(refuse("SERVER_AGE_UNKNOWN", "Your time on the Discord server could not be checked. Please try again."));
  }
  const serverReady = guildJoinedAt + CLUB_LIMITS.createServerDays * DAY_MS;
  if (now < serverReady) {
    return no(
      refuse(
        "CREATE_TOO_NEW",
        `You can create a club ${CLUB_LIMITS.createServerDays} days after joining the Discord server.`,
        serverReady,
      ),
    );
  }
  if (player.lastClubCreatedAt !== null) {
    const cooldownEnd = player.lastClubCreatedAt + CLUB_LIMITS.createCooldownDays * DAY_MS;
    if (now < cooldownEnd) {
      return no(
        refuse(
          "CREATE_COOLDOWN",
          `You can create a club ${CLUB_LIMITS.createCooldownDays} days after the last one you created.`,
          cooldownEnd,
        ),
      );
    }
  }
  return { allowed: true, refusal: null };
}

export function decideCreate(
  state: LockedState,
  input: NewClubValue,
  context: {
    readonly guildJoinedAt: number | null;
    readonly publicId: string;
    readonly nameTaken: boolean;
    readonly tagTaken: boolean;
  },
): Decision<{ readonly name: string; readonly tag: string }> {
  const { actor, now } = state;
  const eligibility = createEligibility(actor, context.guildJoinedAt, now);
  if (eligibility.refusal) return eligibility.refusal;
  if (context.nameTaken) return refuse("NAME_TAKEN", "A club with this name exists already.");
  if (context.tagTaken) return refuse("TAG_TAKEN", "A club with this tag exists already.");
  const club = { clubId: NEW_CLUB, publicId: context.publicId, name: input.name, tag: input.tag };
  return done(
    [
      {
        kind: "createClub",
        club: {
          publicId: context.publicId,
          name: input.name,
          tag: input.tag,
          ownerDiscordId: actor.discordId,
          settings: input.settings,
          createdAt: now,
          // L2: the creation counts as the first confirmation of activity.
          activity: now,
        },
      },
      { kind: "addMember", clubId: NEW_CLUB, playerId: actor.playerId, isOfficer: true },
      { kind: "setPlayerState", playerId: actor.playerId, set: { lastClubCreatedAt: now } },
      ...closePlayersInvitations(state, actor.playerId, "closed"),
      event(
        "club.created",
        club,
        { actor: person(actor), nick: [{ discord_id: actor.discordId, old_tag: "" }] },
        { actor: actor.playerId },
      ),
      log("WebsiteClubCreate", {
        name: input.name,
        tag: input.tag,
        public_id: context.publicId,
        player_id: actor.playerId,
        discord_id: actor.discordId,
      }),
    ],
    { name: input.name, tag: input.tag },
  );
}

// ---------------------------------------------------------------------------------------------------
// J1 joining, J2 invitations

export function decideJoin(state: LockedState, clubId: number): Decision<{ readonly clubId: number }> {
  const { actor, now } = state;
  if (actor.clubId !== null) return refuse("ALREADY_IN_CLUB", "Leave your club before you join another one.");
  const club = state.clubs.get(clubId);
  if (!club) return refuse("CLUB_NOT_FOUND", "This club does not exist.");
  if (!club.settings.isOpen) return refuse("CLUB_INVITE_ONLY", "This club takes invited players only.");
  if (actor.lastClubExitAt !== null && now < actor.lastClubExitAt + CLUB_LIMITS.leaveCooldownHours * HOUR_MS) {
    return refuse(
      "JOIN_COOLDOWN",
      `You can join a club ${CLUB_LIMITS.leaveCooldownHours} hour after leaving one.`,
      actor.lastClubExitAt + CLUB_LIMITS.leaveCooldownHours * HOUR_MS,
    );
  }
  const block = state.joinBlocks.find((entry) => entry.clubId === clubId && entry.playerId === actor.playerId);
  if (block && now < block.until) {
    return refuse("REJOIN_BLOCKED", "You were removed from this club and cannot join it again yet.", block.until);
  }
  return done(joinPlan(state, club, "join"), { clubId });
}

export function decideInvite(
  state: LockedState,
  context: { readonly targetOnServer: boolean },
): Decision<{ readonly playerId: number }> {
  const club = managersClub(state);
  if ("ok" in club) return club;
  const { target, now, actor } = state;
  if (!target) return refuse("PLAYER_NOT_FOUND", "This player has no player profile.");
  if (target.clubId !== null) return refuse("PLAYER_IN_CLUB", "This player is in a club already.");
  if (!context.targetOnServer) return refuse("PLAYER_NOT_ON_SERVER", "This player is not on the Discord server.");
  const ofClub = state.invitations.filter((invitation) => invitation.clubId === club.clubId);
  if (ofClub.filter((invitation) => invitation.status === "open").length >= CLUB_LIMITS.maxOpenInvitations) {
    return refuse("INVITATION_LIMIT", `A club can have at most ${CLUB_LIMITS.maxOpenInvitations} open invitations.`);
  }
  const previous = ofClub
    .filter((invitation) => invitation.playerId === target.playerId)
    .reduce<number | null>((latest, invitation) => Math.max(latest ?? 0, invitation.createdAt), null);
  const reinviteAt = previous === null ? 0 : previous + CLUB_LIMITS.reinviteDays * DAY_MS;
  if (now < reinviteAt) {
    return refuse(
      "REINVITE_TOO_SOON",
      `Your club can invite this player again ${CLUB_LIMITS.reinviteDays} days after the last invitation.`,
      reinviteAt,
    );
  }
  const expiresAt = now + CLUB_LIMITS.invitationDays * DAY_MS;
  return done(
    [
      // J4: an invitation lifts a removed member's block.
      { kind: "liftJoinBlock", clubId: club.clubId, playerId: target.playerId },
      { kind: "invite", clubId: club.clubId, playerId: target.playerId, invitedByPlayerId: actor.playerId, expiresAt },
      event(
        "invitation.created",
        { clubId: club.clubId, publicId: club.publicId, name: club.name, tag: club.tag },
        {
          actor: person(actor),
          target: person(target),
          dm: dmTo([target.discordId], "invitation"),
          invitation: { id: null, status: "open", expires_at: iso(expiresAt), invited_by: actor.name },
        },
        { actor: actor.playerId, target: target.playerId, newInvitation: true },
      ),
      log("WebsiteClubInvite", { club_id: club.clubId, player_id: target.playerId, by: actor.playerId }),
    ],
    { playerId: target.playerId },
  );
}

export function decideRevoke(state: LockedState, invitationId: number): Decision<{ readonly invitationId: number }> {
  const club = managersClub(state);
  if ("ok" in club) return club;
  const invitation = state.invitations.find((entry) => entry.id === invitationId && entry.clubId === club.clubId);
  if (!invitation) return refuse("INVITATION_NOT_FOUND", "This invitation does not exist.");
  if (invitation.status !== "open") return refuse("INVITATION_CLOSED", "This invitation is not open any more.");
  return done(
    [
      ...closeInvitations([invitation], "revoked", () => club),
      log("WebsiteClubRevoke", { club_id: club.clubId, invitation_id: invitationId, by: state.actor.playerId }),
    ],
    { invitationId },
  );
}

/** The invitee answers, on the page or with the DM's buttons: accepting re-checks everything (J2). */
export function decideAnswer(
  state: LockedState,
  invitationId: number,
  accept: boolean,
): Decision<{ readonly clubId: number; readonly accepted: boolean }> {
  const { actor, now } = state;
  const invitation = state.invitations.find((entry) => entry.id === invitationId && entry.playerId === actor.playerId);
  if (!invitation) return refuse("INVITATION_NOT_FOUND", "This invitation does not exist.");
  if (invitation.status !== "open" || now >= invitation.expiresAt) {
    return refuse("INVITATION_CLOSED", "This invitation is not open any more.");
  }
  if (!accept) {
    return done(
      [
        ...closeInvitations([invitation], "declined", (clubId) => state.clubs.get(clubId)),
        log("WebsiteClubDecline", {
          club_id: invitation.clubId,
          invitation_id: invitationId,
          player_id: actor.playerId,
        }),
      ],
      { clubId: invitation.clubId, accepted: false },
    );
  }
  if (actor.clubId !== null) return refuse("ALREADY_IN_CLUB", "Leave your club before you accept an invitation.");
  const club = state.clubs.get(invitation.clubId);
  if (!club) return refuse("CLUB_NOT_FOUND", "This club does not exist any more.");
  return done(
    [...joinPlan(state, club, "invitation", invitationId), invitationClosedEvent(club, invitation, "accepted")],
    { clubId: club.clubId, accepted: true },
  );
}

// ---------------------------------------------------------------------------------------------------
// Leaving, removing, roles

export function decideLeave(
  state: LockedState,
  context: { readonly isOnServer: (discordId: string) => boolean },
): Decision<{ readonly clubId: number; readonly deleted: boolean; readonly newCaptainPlayerId: number | null }> {
  const club = actorsClub(state);
  if ("ok" in club) return club;
  const { actor } = state;
  const member = memberOf(club, actor.playerId);
  if (!member) return refuse("NOT_IN_CLUB", "You are not in a club.");
  const departure = departurePlan(state, club, member, context.isOnServer);
  const removed = new Set([actor.playerId]);
  return done(
    [
      ...departure.steps,
      event(
        "member.left",
        { clubId: club.clubId, publicId: club.publicId, name: club.name, tag: club.tag },
        {
          target: person(actor),
          dm: departure.deleted
            ? []
            : dmTo(managersAfter(club, removed, departure.newCaptain), "member_left", [actor.discordId]),
          nick: [{ discord_id: actor.discordId, old_tag: club.tag }],
          transfer: { action: "left", discord_id: actor.discordId, country: actor.country },
          reason: "left",
        },
        { actor: actor.playerId, target: actor.playerId },
      ),
      log("WebsiteClubLeave", { club_id: club.clubId, player_id: actor.playerId, discord_id: actor.discordId }),
    ],
    { clubId: club.clubId, deleted: departure.deleted, newCaptainPlayerId: departure.newCaptain?.playerId ?? null },
  );
}

export function decideRemove(state: LockedState, targetPlayerId: number): Decision<{ readonly playerId: number }> {
  const club = managersClub(state);
  if ("ok" in club) return club;
  const { actor, now } = state;
  if (targetPlayerId === actor.playerId) return refuse("CANNOT_TARGET_SELF", "Leave the club instead.");
  const target = memberOf(club, targetPlayerId);
  if (!target) return refuse("TARGET_NOT_IN_CLUB", "This player is not in your club.");
  const actorRole = roleOf(club, actor.playerId);
  const targetRole = roleOf(club, targetPlayerId);
  if (targetRole === "captain") return refuse("NOT_ALLOWED", "Nobody can remove the captain.");
  if (actorRole === "officer" && targetRole !== "member") {
    return refuse("NOT_ALLOWED", "Officers can remove normal members only.");
  }
  return done(
    [
      { kind: "removeMember", playerId: targetPlayerId },
      { kind: "setPlayerState", playerId: targetPlayerId, set: { lastClubExitAt: now } },
      // J4: a removed member cannot rejoin this club for 14 days (an invitation lifts it).
      {
        kind: "setJoinBlock",
        clubId: club.clubId,
        playerId: targetPlayerId,
        until: now + CLUB_LIMITS.rejoinBlockDays * DAY_MS,
      },
      ...updateClub(club.clubId, streakUpdate(club, club.members.length - 1, now)),
      event(
        "member.removed",
        { clubId: club.clubId, publicId: club.publicId, name: club.name, tag: club.tag },
        {
          actor: person(actor),
          target: person(target),
          dm: dmTo([target.discordId], "member_removed"),
          nick: [{ discord_id: target.discordId, old_tag: club.tag }],
          transfer: { action: "removed", discord_id: target.discordId, country: target.country },
          reason: "removed",
        },
        { actor: actor.playerId, target: targetPlayerId },
      ),
      log("WebsiteClubRemove", { club_id: club.clubId, player_id: targetPlayerId, by: actor.playerId }),
    ],
    { playerId: targetPlayerId },
  );
}

export function decideSetOfficer(
  state: LockedState,
  targetPlayerId: number,
  officer: boolean,
): Decision<{ readonly playerId: number; readonly officer: boolean }> {
  const club = actorsClub(state);
  if ("ok" in club) return club;
  const { actor } = state;
  const target = memberOf(club, targetPlayerId);
  if (!target) return refuse("TARGET_NOT_IN_CLUB", "This player is not in your club.");
  const actorRole = roleOf(club, actor.playerId);
  const targetRole = roleOf(club, targetPlayerId);
  const self = targetPlayerId === actor.playerId;
  if (officer) {
    if (actorRole !== "captain" && actorRole !== "officer")
      return refuse("NOT_ALLOWED", "Only the captain and the officers can promote.");
    if (targetRole !== "member") return refuse("ALREADY_OFFICER", "This player is an officer or the captain already.");
    if (officersOf(club).length >= CLUB_LIMITS.maxOfficers) {
      return refuse(
        "OFFICER_LIMIT",
        `A club can have at most ${CLUB_LIMITS.maxOfficers} officers besides the captain.`,
      );
    }
  } else {
    if (targetRole !== "officer") return refuse("NOT_OFFICER", "This player is not an officer.");
    if (actorRole !== "captain" && !(actorRole === "officer" && self)) {
      return refuse("NOT_ALLOWED", "Only the captain can demote another officer.");
    }
  }
  const kind: ClubDmKind = officer ? "promoted" : "demoted";
  return done(
    [
      { kind: "updateMember", playerId: targetPlayerId, set: { isOfficer: officer } },
      event(
        officer ? "member.promoted" : "member.demoted",
        { clubId: club.clubId, publicId: club.publicId, name: club.name, tag: club.tag },
        { actor: person(actor), target: person(target), dm: dmTo([target.discordId], kind, [actor.discordId]) },
        { actor: actor.playerId, target: targetPlayerId },
      ),
      log(officer ? "WebsiteClubPromote" : "WebsiteClubDemote", {
        club_id: club.clubId,
        player_id: targetPlayerId,
        by: actor.playerId,
      }),
    ],
    { playerId: targetPlayerId, officer },
  );
}

// ---------------------------------------------------------------------------------------------------
// Settings, activity, deletion

/** A hash of the club's settings as the page loaded them; a save over a newer state is refused (409). */
export function settingsVersion(settings: ClubSettingsValue): string {
  return createHash("sha256")
    .update(JSON.stringify(settingsKey(settings)))
    .digest("base64url");
}

function settingsKey(settings: ClubSettingsValue): unknown[] {
  return [
    settings.isOpen,
    settings.regions,
    settings.clubCodes,
    settings.firstUniform,
    settings.secondUniform,
    settings.stadium,
    settings.discordUrl,
  ];
}

export function decideSettings(
  state: LockedState,
  settings: ClubSettingsValue,
  version: string,
): Decision<{ readonly changed: boolean }> {
  const club = managersClub(state);
  if ("ok" in club) return club;
  // Asking for what is saved already succeeds, also with an old version (a double click).
  if (JSON.stringify(settingsKey(settings)) === JSON.stringify(settingsKey(club.settings)))
    return done([], { changed: false });
  if (version !== settingsVersion(club.settings)) {
    return refuse("CLUB_CHANGED", "The club's settings were changed meanwhile. Check them and save again.");
  }
  return done(
    [
      { kind: "updateClub", clubId: club.clubId, set: { settings } },
      log("WebsiteClubSettings", { club_id: club.clubId, by: state.actor.playerId, settings }),
    ],
    { changed: true },
  );
}

export function decideConfirmActivity(state: LockedState): Decision<{ readonly activity: number }> {
  const club = managersClub(state);
  if ("ok" in club) return club;
  return done(
    [
      { kind: "updateClub", clubId: club.clubId, set: { activity: state.now } },
      log("WebsiteClubActivity", { club_id: club.clubId, by: state.actor.playerId }),
    ],
    { activity: state.now },
  );
}

/**
 * F6: the captain and the officers set the club's logo; Club.Logo then names its public URL (with the hash), so
 * the bot's /club info and its API show the uploaded logo too.
 */
export function decideSetLogo(
  state: LockedState,
  logo: StoredLogo,
  urlOf: (clubId: number) => string,
): Decision<{ readonly hash: string }> {
  const club = managersClub(state);
  if ("ok" in club) return club;
  return done(
    [
      { kind: "setLogo", clubId: club.clubId, logo },
      { kind: "updateClub", clubId: club.clubId, set: { logo: urlOf(club.clubId) } },
      log("WebsiteClubLogo", { club_id: club.clubId, by: state.actor.playerId, hash: logo.hash }),
    ],
    { hash: logo.hash },
  );
}

/** The logo goes (an uploaded one and an older link alike). */
export function removeLogoPlan(club: Pick<ClubState, "clubId">, by: Record<string, unknown>): PlanStep[] {
  return [
    { kind: "removeLogo", clubId: club.clubId },
    { kind: "updateClub", clubId: club.clubId, set: { logo: null } },
    log("WebsiteClubLogoRemoved", { club_id: club.clubId, ...by }),
  ];
}

export function decideRemoveLogo(state: LockedState): Decision<{ readonly clubId: number }> {
  const club = managersClub(state);
  if ("ok" in club) return club;
  return done(removeLogoPlan(club, { by: state.actor.playerId }), { clubId: club.clubId });
}

/** C2: only the captain, confirmed by typing the club's tag exactly. */
export function decideDelete(state: LockedState, confirmTag: string): Decision<{ readonly clubId: number }> {
  const club = actorsClub(state);
  if ("ok" in club) return club;
  if (roleOf(club, state.actor.playerId) !== "captain")
    return refuse("NOT_ALLOWED", "Only the captain can delete the club.");
  if (confirmTag.trim() !== club.tag.trim())
    return refuse("CONFIRMATION_MISMATCH", "Type the club's tag exactly to confirm.");
  return done(deletionPlan(state, club, "deleted by the captain", { actor: state.actor, by: "captain" }), {
    clubId: club.clubId,
  });
}

// ---------------------------------------------------------------------------------------------------
// B2 the Admin Panel: an admin renames any club (on a request made by hand), removes its logo or deletes it. The
// admin route checks the admin and logs each action; the admin need not be a member.

function anyClub(state: LockedState, clubId: number): ClubState | ClubRefusal {
  return state.clubs.get(clubId) ?? refuse("CLUB_NOT_FOUND", "This club does not exist.");
}

/** The new name and tag are checked by the shared rules (unchanged ones may keep older characters, F8). */
export function decideAdminRename(
  state: LockedState,
  clubId: number,
  input: { readonly name: string; readonly tag: string },
  context: { readonly nameTaken: boolean; readonly tagTaken: boolean },
): Decision<{ readonly name: string; readonly tag: string; readonly oldName: string; readonly oldTag: string }> {
  const club = anyClub(state, clubId);
  if ("ok" in club) return club;
  const renamed = input.name !== club.name;
  const retagged = input.tag !== club.tag;
  const result = { name: input.name, tag: input.tag, oldName: club.name, oldTag: club.tag };
  if (!renamed && !retagged) return done([], result);
  if (renamed && context.nameTaken) return refuse("NAME_TAKEN", "A club with this name exists already.");
  if (retagged && context.tagTaken) return refuse("TAG_TAKEN", "A club with this tag exists already.");
  return done(
    [
      {
        kind: "updateClub",
        clubId,
        set: { ...(renamed ? { name: input.name } : {}), ...(retagged ? { tag: input.tag } : {}) },
      },
      event(
        "club.renamed",
        { clubId, publicId: club.publicId, name: input.name, tag: input.tag },
        {
          actor: person(state.actor),
          // The members' nicknames take the new tag (the old one names what to take off).
          nick: retagged ? club.members.map((member) => ({ discord_id: member.discordId, old_tag: club.tag })) : [],
          reason: "renamed by an admin",
        },
        { actor: state.actor.playerId },
      ),
      log("WebsiteAdminClubRename", {
        club_id: clubId,
        public_id: club.publicId,
        old_name: club.name,
        old_tag: club.tag,
        name: input.name,
        tag: input.tag,
        by: state.actor.discordId,
      }),
    ],
    result,
  );
}

export function decideAdminRemoveLogo(state: LockedState, clubId: number): Decision<{ readonly clubId: number }> {
  const club = anyClub(state, clubId);
  if ("ok" in club) return club;
  return done(removeLogoPlan(club, { by: "admin", admin_discord_id: state.actor.discordId }), { clubId });
}

/** The club goes completely, as when its captain deletes it; every member gets the DM. */
export function decideAdminDelete(
  state: LockedState,
  clubId: number,
  confirmTag: string,
): Decision<{ readonly clubId: number; readonly name: string; readonly tag: string }> {
  const club = anyClub(state, clubId);
  if ("ok" in club) return club;
  if (confirmTag.trim() !== club.tag.trim())
    return refuse("CONFIRMATION_MISMATCH", "Type the club's tag exactly to confirm.");
  return done(deletionPlan(state, club, "deleted by an admin", { actor: state.actor, by: "admin" }), {
    clubId,
    name: club.name,
    tag: club.tag,
  });
}

// ---------------------------------------------------------------------------------------------------
// The lifecycle job

/**
 * L1 for a club the counter still runs for (created on the website, not established): established after a 7-day
 * streak of two members; otherwise, alone 30 days after its creation, marked inactive, and 14 days later deleted;
 * a running streak postpones both. Warnings before both steps.
 */
export function decideNewClubCounter(state: Pick<LockedState, "now" | "invitations">, club: ClubState): PlanStep[] {
  const { now } = state;
  if (club.establishedAt !== null || club.createdAt === null) return [];
  const ref = { clubId: club.clubId, publicId: club.publicId, name: club.name, tag: club.tag };
  const captain = captainOf(club);
  const toCaptain = (kind: ClubDmKind) => dmTo(captain ? [captain.discordId] : [], kind);
  if (club.streakSince !== null) {
    if (now < club.streakSince + CLUB_LIMITS.streakDays * DAY_MS) return [];
    return updateClub(club.clubId, {
      establishedAt: now,
      inactiveSince: null,
      inactiveWarnedAt: null,
      deletionWarnedAt: null,
    });
  }
  if (club.members.length >= 2) return updateClub(club.clubId, { streakSince: now });

  const inactiveAt = club.createdAt + CLUB_LIMITS.newClubAloneDays * DAY_MS;
  if (club.inactiveSince === null) {
    if (now >= inactiveAt) {
      const deletionAt = now + CLUB_LIMITS.newClubDeletionDays * DAY_MS;
      return [
        ...updateClub(club.clubId, { inactiveSince: now }),
        event("club.marked_inactive", ref, { dm: toCaptain("marked_inactive"), deletion_at: iso(deletionAt) }),
      ];
    }
    if (now >= inactiveAt - L1_WARNING_DAYS.inactive * DAY_MS && club.inactiveWarnedAt === null) {
      return [
        ...updateClub(club.clubId, { inactiveWarnedAt: now }),
        event("club.inactivity_warning", ref, { dm: toCaptain("inactivity_warning"), inactive_at: iso(inactiveAt) }),
      ];
    }
    return [];
  }
  const deletionAt = club.inactiveSince + CLUB_LIMITS.newClubDeletionDays * DAY_MS;
  if (now >= deletionAt) return deletionPlan(state, club, "inactive new club", { by: "lifecycle" });
  if (now >= deletionAt - L1_WARNING_DAYS.deletion * DAY_MS && club.deletionWarnedAt === null) {
    return [
      ...updateClub(club.clubId, { deletionWarnedAt: now }),
      event("club.deletion_warning", ref, { dm: toCaptain("deletion_warning"), deletion_at: iso(deletionAt) }),
    ];
  }
  return [];
}

/**
 * J5 for one club: members back on the server lose their stamp and exemption, members who left get stamped (unless
 * exempt from go-live), and members gone for 14 days are removed — told like a leave, with S1 for a captain.
 */
export function decideAbsence(
  state: Pick<LockedState, "now" | "invitations">,
  club: ClubState,
  isOnServer: (discordId: string) => boolean,
): PlanStep[] {
  const { now } = state;
  const steps: PlanStep[] = [];
  const leaving = new Set<number>();
  for (const member of club.members) {
    if (isOnServer(member.discordId)) {
      if (member.absentSince !== null || member.absenceExempt) {
        steps.push({
          kind: "updateMember",
          playerId: member.playerId,
          set: { absentSince: null, absenceExempt: false },
        });
      }
    } else if (!member.absenceExempt) {
      if (member.absentSince === null) {
        steps.push({ kind: "updateMember", playerId: member.playerId, set: { absentSince: now } });
      } else if (now >= member.absentSince + CLUB_LIMITS.absenceDays * DAY_MS) {
        leaving.add(member.playerId);
      }
    }
  }
  if (!leaving.size) return steps;

  const remaining = club.members.filter((member) => !leaving.has(member.playerId));
  if (!remaining.length) {
    return [...steps, ...deletionPlan(state, club, "every member left the Discord server", { by: "lifecycle" })];
  }
  const captain = captainOf(club);
  const newCaptain = captain && leaving.has(captain.playerId) ? successorOf(club, leaving, isOnServer) : null;
  const ref = { clubId: club.clubId, publicId: club.publicId, name: club.name, tag: club.tag };
  for (const playerId of leaving) {
    const member = memberOf(club, playerId);
    if (!member) continue;
    steps.push(
      { kind: "removeMember", playerId },
      { kind: "setPlayerState", playerId, set: { lastClubExitAt: now } },
      event(
        "member.left",
        ref,
        {
          target: person(member),
          dm: dmTo(managersAfter(club, leaving, newCaptain), "member_left"),
          nick: [{ discord_id: member.discordId, old_tag: club.tag }],
          transfer: { action: "left", discord_id: member.discordId, country: member.country },
          reason: "absent",
        },
        { target: playerId },
      ),
      log("WebsiteClubAbsence", {
        club_id: club.clubId,
        player_id: playerId,
        absent_since: iso(member.absentSince ?? now),
      }),
    );
  }
  const set: ClubUpdate = { ...streakUpdate(club, remaining.length, now) };
  if (newCaptain) {
    if (!newCaptain.isOfficer)
      steps.push({ kind: "updateMember", playerId: newCaptain.playerId, set: { isOfficer: true } });
    steps.push(
      event(
        "captain.changed",
        ref,
        { target: person(newCaptain), dm: dmTo([newCaptain.discordId], "new_captain"), reason: "succession" },
        { target: newCaptain.playerId },
      ),
    );
    steps.push(...updateClub(club.clubId, { ...set, ownerDiscordId: newCaptain.discordId }));
  } else {
    steps.push(...updateClub(club.clubId, set));
  }
  return steps;
}

/** J2: open invitations past their time expire (their DMs lose the buttons). */
export function decideExpiry(
  now: number,
  invitations: readonly InvitationState[],
  clubOf: (clubId: number) => ClubLabel | undefined,
): PlanStep[] {
  return closeInvitations(
    invitations.filter((invitation) => invitation.status === "open" && now >= invitation.expiresAt),
    "expired",
    clubOf,
  );
}
