// Club management for the signed-in member (My Club, docs/adr/0012) and for the bot's invitation buttons: who may
// act (the feature's mode; in mode "admins" only confirmed admins), the acting member's live server membership (A3,
// checked on every change and failing closed), the request's validation, and one store transaction with the
// decision of rules.ts. The actor always comes from the session (or, for a button, from Discord through the bot);
// no request names it.

import {
  CLUB_LIMITS,
  clubNameKey,
  validateClubSettings,
  validateNewClub,
  type ClubFieldError,
  type ClubSettingsValue,
} from "@ms/shared/clubs";
import type { GuildMemberSnapshot } from "../../integrations/discord/guild-members.ts";
import type { GuildMember, GuildMemberLookup } from "../../integrations/discord/members.ts";
import type { DiscordIdentity } from "../profile/mappers.ts";
import { duplicateKeyName } from "../../lib/sql-errors.ts";
import type { ChangeScope, ClubStore, ClubSystemRow, MyClubRow } from "./management-repository.ts";
import {
  DAY_MS,
  createEligibility,
  generateClubPublicId,
  decideAnswer,
  decideConfirmActivity,
  decideCreate,
  decideDelete,
  decideInvite,
  decideJoin,
  decideLeave,
  decideRemove,
  decideRevoke,
  decideSetOfficer,
  decideSettings,
  inClubOrder,
  memberActionsOf,
  officersOf,
  permissionsOf,
  refuse,
  roleOf,
  settingsVersion,
  type ClubPermissions,
  type ClubRefusal,
  type ClubRole,
  type Decision,
  type LockedState,
} from "./rules.ts";

/** Which of dbo.Club's and dbo.ClubRoster's unique keys a duplicate key error hit. */
const DUPLICATE_KEYS: Readonly<Record<string, "name" | "tag" | "publicId" | "member">> = {
  UX_Club_ClubName: "name",
  IX_Club: "tag",
  UX_Club_PublicId: "publicId",
  PK_ClubRoster: "member",
};

function duplicateIndex(error: unknown): "name" | "tag" | "publicId" | "member" | "" {
  return DUPLICATE_KEYS[duplicateKeyName(error)] ?? "";
}

// ---------------------------------------------------------------------------------------------------
// What the routes get back

export type ClubOutcome<T> =
  | { readonly kind: "ok"; readonly result: T }
  | { readonly kind: "refused"; readonly refusal: ClubRefusal }
  | { readonly kind: "invalid"; readonly errors: readonly ClubFieldError[] }
  /** My Club is not open for this member (mode off, or mode admins and no admin). */
  | { readonly kind: "closed" }
  /** The member is not on the Discord server (any more). */
  | { readonly kind: "not_member" }
  /** Discord could not be asked whether the member is on the server; nothing was changed. */
  | { readonly kind: "discord_unavailable" };

export interface MemberView {
  readonly playerId: number;
  readonly name: string;
  readonly country: string;
  /** The Discord username, from the server's member list; "" when the member is not on the server. */
  readonly discordName: string;
  readonly role: ClubRole;
  readonly joinedAt: number | null;
  /** Not on the server now (shown to the captain and the officers only). */
  readonly absent: boolean;
  readonly actions: { readonly remove: boolean; readonly promote: boolean; readonly demote: boolean };
}

export interface ClubView {
  readonly clubId: number;
  readonly name: string;
  readonly tag: string;
  readonly logo: string;
  readonly settings: ClubSettingsValue;
  /** The version a settings save sends back (409 when the club changed meanwhile). */
  readonly settingsVersion: string;
  readonly activity: number | null;
  /** The 90-day rule, overridden by the new-club counter's inactive mark. */
  readonly isActive: boolean;
  readonly createdAt: number | null;
  /** The new-club counter: when the club is marked inactive, and when it is deleted; null once established. */
  readonly inactiveAt: number | null;
  readonly deletionAt: number | null;
  readonly role: ClubRole;
  readonly permissions: ClubPermissions;
  readonly officers: { readonly count: number; readonly max: number };
  readonly members: readonly MemberView[];
  /** Open invitations of the club (for the captain and the officers). */
  readonly invitations: readonly {
    readonly id: number;
    readonly playerId: number;
    readonly name: string;
    readonly invitedBy: string;
    readonly createdAt: number;
    readonly expiresAt: number;
  }[];
}

export interface MyClubView {
  readonly playerId: number;
  readonly club: ClubView | null;
  /** Open invitations to the member (shown also when DMs are closed). */
  readonly invitations: readonly {
    readonly id: number;
    readonly clubId: number;
    readonly clubName: string;
    readonly clubTag: string;
    readonly invitedBy: string;
    readonly createdAt: number;
    readonly expiresAt: number;
  }[];
  /** Whether the member may create a club now, and why not. */
  readonly create: { readonly allowed: boolean; readonly refusal: ClubRefusal | null };
  /** J3: joining a club by oneself waits until then; null when it does not. */
  readonly joinCooldownUntil: number | null;
  /** J4: clubs the member cannot rejoin yet. */
  readonly joinBlocks: readonly { readonly clubId: number; readonly until: number }[];
}

export interface InviteCandidate {
  readonly playerId: number;
  readonly name: string;
  readonly discordName: string;
  readonly country: string;
  /** Null when the club can invite them now, else why not (open invitation, 14 days not over). */
  readonly blockedUntil: number | null;
}

export interface ClubRequest {
  /** The request's cookie header, for the admin check of mode "admins". */
  readonly cookie: unknown;
  readonly identity: DiscordIdentity;
}

export interface ClubManagement {
  /** Whether My Club is open for this request: the account menu's entry and the page. */
  isOpen(cookie: unknown): Promise<boolean>;
  view(request: ClubRequest): Promise<ClubOutcome<MyClubView>>;
  create(request: ClubRequest, body: unknown): Promise<ClubOutcome<MyClubView>>;
  updateSettings(request: ClubRequest, body: unknown): Promise<ClubOutcome<MyClubView>>;
  join(request: ClubRequest, clubId: number): Promise<ClubOutcome<MyClubView>>;
  leave(request: ClubRequest): Promise<ClubOutcome<MyClubView>>;
  removeMember(request: ClubRequest, playerId: number): Promise<ClubOutcome<MyClubView>>;
  setOfficer(request: ClubRequest, playerId: number, officer: boolean): Promise<ClubOutcome<MyClubView>>;
  inviteCandidates(
    request: ClubRequest,
    query: string,
    page: number,
  ): Promise<
    ClubOutcome<{ readonly candidates: readonly InviteCandidate[]; readonly total: number; readonly page: number }>
  >;
  invite(request: ClubRequest, playerId: number): Promise<ClubOutcome<MyClubView>>;
  revoke(request: ClubRequest, invitationId: number): Promise<ClubOutcome<MyClubView>>;
  answer(request: ClubRequest, invitationId: number, accept: boolean): Promise<ClubOutcome<MyClubView>>;
  /** The invitee pressed a button in the bot's DM: the same rules, with the Discord id the bot names. */
  answerFromDiscord(
    discordUserId: string,
    invitationId: number,
    accept: boolean,
  ): Promise<ClubOutcome<{ readonly accepted: boolean; readonly clubName: string; readonly clubTag: string }>>;
  confirmActivity(request: ClubRequest): Promise<ClubOutcome<MyClubView>>;
  deleteClub(request: ClubRequest, confirmTag: string): Promise<ClubOutcome<MyClubView>>;
}

export interface ClubManagementOptions {
  readonly store: ClubStore;
  /** Live lookups of one member (the acting member, an invitee), with the bot token. */
  readonly members: GuildMemberLookup;
  /** The server's member list: who is on the server (invite list, succession), names, roles. */
  readonly memberList: { get(): Promise<GuildMemberSnapshot | null> };
  /** The player profile of a member, created when it is missing (the login normally did). */
  readonly ensurePlayer: (identity: DiscordIdentity) => Promise<{ readonly playerId: number }>;
  /** Whether the request's session belongs to a confirmed admin (the admin guard). */
  readonly isAdmin: (cookie: unknown) => Promise<boolean>;
  /** The server roles that make a member an admin, for members without a session (DM buttons, invitees). */
  readonly adminRoleIds: readonly string[];
  /** The URL a club's logo is shown from ("" for none). */
  readonly logoUrl: (club: {
    readonly clubId: number;
    readonly logoUrl: string;
    readonly logoHash: string;
    readonly tag: string;
    readonly name: string;
  }) => Promise<string>;
  readonly now?: () => number;
  /** How long the mode is cached (default 30 s; the bot reads it uncached, so it closes first). */
  readonly modeTtlMs?: number;
  /** Runs after a change, e.g. to refresh the public club list. */
  readonly onChange?: () => void;
}

const CANDIDATES_PER_PAGE = 20;

// ---------------------------------------------------------------------------------------------------

export function createClubManagement(options: ClubManagementOptions): ClubManagement {
  const { store, members } = options;
  const now = options.now ?? Date.now;
  let mode: { readonly at: number; readonly value: Promise<ClubSystemRow> } | null = null;

  function system(): Promise<ClubSystemRow> {
    const ttl = options.modeTtlMs ?? 30_000;
    if (!mode || now() - mode.at >= ttl) mode = { at: now(), value: store.readMode() };
    return mode.value;
  }

  async function isOpen(cookie: unknown): Promise<boolean> {
    const { mode: current } = await system();
    if (current === "on") return true;
    return current === "admins" && (await options.isAdmin(cookie));
  }

  const isAdminMember = (member: Pick<GuildMember, "roles">): boolean =>
    member.roles.some((role) => options.adminRoleIds.includes(role));

  /** A3: the acting member, asked live; refusals as outcomes. */
  async function liveMember(discordId: string): Promise<GuildMember | ClubOutcome<never>> {
    let member: GuildMember;
    try {
      member = await members.getMember(discordId, { fresh: true });
    } catch {
      return { kind: "discord_unavailable" };
    }
    if (member.membership === "not_member") return { kind: "not_member" };
    if (member.membership !== "member") return { kind: "discord_unavailable" };
    return member;
  }

  const isOutcome = (value: unknown): value is ClubOutcome<never> =>
    typeof value === "object" && value !== null && "kind" in value;

  async function presence(): Promise<(discordId: string) => boolean> {
    const snapshot = await options.memberList.get().catch(() => null);
    // Without any list, nobody is skipped: the order alone decides (succession), and the invitee is asked live.
    return snapshot ? (discordId) => snapshot.members.has(discordId) : () => true;
  }

  async function buildView(row: MyClubRow, playerId: number): Promise<MyClubView> {
    const at = now();
    const snapshot = await options.memberList.get().catch(() => null);
    const { player } = row;
    const club = row.club;
    let clubView: ClubView | null = null;
    if (club) {
      const role = roleOf(club, playerId) ?? "member";
      const manager = role === "captain" || role === "officer";
      const counting = club.establishedAt === null && club.createdAt !== null;
      clubView = {
        clubId: club.clubId,
        name: club.name,
        tag: club.tag,
        logo: await options.logoUrl({
          clubId: club.clubId,
          logoUrl: club.logoUrl,
          logoHash: club.logoHash,
          tag: club.tag,
          name: club.name,
        }),
        settings: club.settings,
        settingsVersion: settingsVersion(club.settings),
        activity: club.activity,
        isActive:
          club.inactiveSince === null &&
          club.activity !== null &&
          at - club.activity <= CLUB_LIMITS.activityDays * DAY_MS,
        createdAt: club.createdAt,
        inactiveAt:
          counting && club.inactiveSince === null && club.streakSince === null
            ? club.createdAt + CLUB_LIMITS.newClubAloneDays * DAY_MS
            : null,
        deletionAt:
          counting && club.inactiveSince !== null
            ? club.inactiveSince + CLUB_LIMITS.newClubDeletionDays * DAY_MS
            : null,
        role,
        permissions: permissionsOf(role),
        officers: { count: officersOf(club).length, max: CLUB_LIMITS.maxOfficers },
        members: inClubOrder(club).map((member) => {
          const listed = snapshot?.members.get(member.discordId);
          return {
            playerId: member.playerId,
            name: member.name,
            country: member.country,
            discordName: listed?.username ?? "",
            role: roleOf(club, member.playerId) ?? "member",
            joinedAt: member.joinedAt,
            absent: manager && snapshot !== null && !listed,
            actions: memberActionsOf(club, playerId, member),
          };
        }),
        invitations: manager
          ? row.clubInvitations.map((invitation) => ({
              id: invitation.id,
              playerId: invitation.playerId,
              name: invitation.playerName,
              invitedBy: invitation.invitedByName,
              createdAt: invitation.createdAt,
              expiresAt: invitation.expiresAt,
            }))
          : [],
      };
    }
    const joinedAt = snapshot?.members.get(player?.discordId ?? "")?.joinedAt ?? null;
    const eligibility = player ? createEligibility(player, joinedAt, at) : { allowed: false, refusal: null };
    const cooldownEnd = player?.lastClubExitAt
      ? player.lastClubExitAt + CLUB_LIMITS.leaveCooldownHours * 60 * 60 * 1000
      : 0;
    return {
      playerId,
      club: clubView,
      invitations: row.invitations.map((invitation) => ({
        id: invitation.id,
        clubId: invitation.clubId,
        clubName: invitation.clubName,
        clubTag: invitation.clubTag,
        invitedBy: invitation.invitedByName,
        createdAt: invitation.createdAt,
        expiresAt: invitation.expiresAt,
      })),
      create: { allowed: eligibility.allowed, refusal: eligibility.refusal },
      joinCooldownUntil: cooldownEnd > at ? cooldownEnd : null,
      joinBlocks: row.joinBlocks.map((block) => ({ clubId: block.clubId, until: block.until })),
    };
  }

  async function readView(playerId: number): Promise<MyClubView> {
    return buildView(await store.readMyClub(playerId, now()), playerId);
  }

  /** The common path of a session change: open, on the server, a profile; then the change and the new view. */
  async function change<T>(
    request: ClubRequest,
    scope: (playerId: number) => Omit<ChangeScope, "actorPlayerId">,
    decide: (
      state: LockedState,
      member: GuildMember,
      extras: { names: ReadonlySet<string>; tags: ReadonlySet<string> },
    ) => Decision<T>,
  ): Promise<ClubOutcome<MyClubView>> {
    if (!(await isOpen(request.cookie))) return { kind: "closed" };
    const member = await liveMember(request.identity.id);
    if (isOutcome(member)) return member;
    const { playerId } = await options.ensurePlayer(request.identity);
    let outcome: { readonly decision: Decision<T> };
    try {
      outcome = await store.change({ ...scope(playerId), actorPlayerId: playerId }, now(), (state, extras) =>
        decide(state, member, extras),
      );
    } catch (error) {
      const refusal = refusalOfDuplicate(error);
      if (refusal) return { kind: "refused", refusal };
      throw error;
    }
    if (!outcome.decision.ok) return { kind: "refused", refusal: outcome.decision };
    if (outcome.decision.plan.length) options.onChange?.();
    return { kind: "ok", result: await readView(playerId) };
  }

  function refusalOfDuplicate(error: unknown): ClubRefusal | null {
    switch (duplicateIndex(error)) {
      case "name":
        return refuse("NAME_TAKEN", "A club with this name exists already.");
      case "tag":
        return refuse("TAG_TAKEN", "A club with this tag exists already.");
      case "member":
        return refuse("ALREADY_IN_CLUB", "This player is in a club already.");
      default:
        return null;
    }
  }

  return {
    isOpen,

    async view(request) {
      if (!(await isOpen(request.cookie))) return { kind: "closed" };
      const { playerId } = await options.ensurePlayer(request.identity);
      return { kind: "ok", result: await readView(playerId) };
    },

    async create(request, body) {
      const checked = validateNewClub(body);
      if (!checked.ok) return { kind: "invalid", errors: checked.errors };
      // A club id that exists already (one in 10^14) is drawn again.
      for (let round = 0; ; round += 1) {
        const publicId = generateClubPublicId();
        try {
          return await change(
            request,
            () => ({ names: true }),
            (state, member, extras) =>
              decideCreate(state, checked.value, {
                guildJoinedAt: member.joinedAt ?? null,
                publicId,
                nameTaken: extras.names.has(clubNameKey(checked.value.name)),
                tagTaken: extras.tags.has(clubNameKey(checked.value.tag)),
              }),
          );
        } catch (error) {
          if (round < 3 && duplicateIndex(error) === "publicId") continue;
          throw error;
        }
      }
    },

    async updateSettings(request, body) {
      const raw = (body ?? {}) as { version?: unknown };
      const version = typeof raw.version === "string" ? raw.version : "";
      // The settings are checked against what the club has saved (an older value may stay), read under the lock.
      const found: { errors: readonly ClubFieldError[] | null } = { errors: null };
      const outcome = await change(
        request,
        () => ({}),
        (state) => {
          const club = state.actor.clubId === null ? undefined : state.clubs.get(state.actor.clubId);
          const checked = validateClubSettings(body, club?.settings);
          if (checked.ok) return decideSettings(state, checked.value, version);
          found.errors = checked.errors;
          return refuse("NOT_ALLOWED", "Some fields are not valid.");
        },
      );
      return found.errors ? { kind: "invalid", errors: found.errors } : outcome;
    },

    async join(request, clubId) {
      return change(
        request,
        () => ({ clubId }),
        (state) => decideJoin(state, clubId),
      );
    },

    async leave(request) {
      const isOnServer = await presence();
      return change(
        request,
        () => ({}),
        (state) => decideLeave(state, { isOnServer }),
      );
    },

    async removeMember(request, playerId) {
      return change(
        request,
        () => ({ targetPlayerId: playerId }),
        (state) => decideRemove(state, playerId),
      );
    },

    async setOfficer(request, playerId, officer) {
      return change(
        request,
        () => ({ targetPlayerId: playerId }),
        (state) => decideSetOfficer(state, playerId, officer),
      );
    },

    async inviteCandidates(request, query, page) {
      if (!(await isOpen(request.cookie))) return { kind: "closed" };
      const { playerId } = await options.ensurePlayer(request.identity);
      const row = await store.readMyClub(playerId, now());
      const club = row.club;
      const role = club ? roleOf(club, playerId) : null;
      if (!club || (role !== "captain" && role !== "officer")) {
        return { kind: "refused", refusal: refuse("NOT_ALLOWED", "Only the captain and the officers can invite.") };
      }
      const snapshot = await options.memberList.get().catch(() => null);
      if (!snapshot) return { kind: "discord_unavailable" };
      const { mode: current } = await system();
      const { players, invitations } = await store.inviteCandidates(club.clubId, now());
      const at = now();
      const needle = query.trim().toLowerCase();
      // J2: players with a profile, in no club, on the server now (in mode "admins" admins only), by name.
      const candidates: InviteCandidate[] = [];
      for (const player of players) {
        const listed = snapshot.members.get(player.discordId);
        if (!listed || (current === "admins" && !isAdminMember(listed))) continue;
        const searched = [player.name, listed.username, listed.globalName, listed.nick].join(" ").toLowerCase();
        if (needle && !searched.includes(needle)) continue;
        const latest = invitations
          .filter((invitation) => invitation.playerId === player.playerId)
          .reduce((max, invitation) => Math.max(max, invitation.createdAt), 0);
        const until = latest ? latest + CLUB_LIMITS.reinviteDays * DAY_MS : 0;
        candidates.push({
          playerId: player.playerId,
          name: player.name,
          discordName: listed.username,
          country: player.country,
          blockedUntil: until > at ? until : null,
        });
      }
      candidates.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.playerId - b.playerId);
      const start = Math.max(0, page - 1) * CANDIDATES_PER_PAGE;
      return {
        kind: "ok",
        result: {
          candidates: candidates.slice(start, start + CANDIDATES_PER_PAGE),
          total: candidates.length,
          page: Math.max(1, page),
        },
      };
    },

    async invite(request, playerId) {
      const { mode: current } = await system();
      // The invitee is asked live: on the server, and an admin while the feature is in mode "admins".
      let targetOnServer = false;
      let targetAllowed = true;
      const discordId = await store.discordIdOf(playerId);
      if (discordId) {
        const live = await members.getMember(discordId).catch(() => null);
        targetOnServer = live?.membership === "member";
        targetAllowed = current !== "admins" || (live !== null && isAdminMember(live));
      }
      if (!targetAllowed) {
        return {
          kind: "refused",
          refusal: refuse("NOT_ALLOWED", "While My Club is being tested, only admins can be invited."),
        };
      }
      return change(
        request,
        () => ({ targetPlayerId: playerId }),
        (state) => decideInvite(state, { targetOnServer }),
      );
    },

    async revoke(request, invitationId) {
      return change(
        request,
        () => ({ invitationId }),
        (state) => decideRevoke(state, invitationId),
      );
    },

    async answer(request, invitationId, accept) {
      return change(
        request,
        () => ({ invitationId }),
        (state) => decideAnswer(state, invitationId, accept),
      );
    },

    async answerFromDiscord(discordUserId, invitationId, accept) {
      const { mode: current } = await system();
      if (current === "off") return { kind: "closed" };
      const member = await liveMember(discordUserId);
      if (isOutcome(member)) return member;
      if (current === "admins" && !isAdminMember(member)) return { kind: "closed" };
      const playerId = await store.playerIdOf(discordUserId);
      if (playerId === null)
        return { kind: "refused", refusal: refuse("INVITATION_NOT_FOUND", "This invitation does not exist.") };
      let clubName = "";
      let clubTag = "";
      let outcome: { readonly decision: Decision<{ readonly clubId: number; readonly accepted: boolean }> };
      try {
        outcome = await store.change({ actorPlayerId: playerId, invitationId }, now(), (state) => {
          const invitation = state.invitations.find((entry) => entry.id === invitationId);
          const club = invitation ? state.clubs.get(invitation.clubId) : undefined;
          clubName = club?.name ?? "";
          clubTag = club?.tag ?? "";
          return decideAnswer(state, invitationId, accept);
        });
      } catch (error) {
        const refusal = refusalOfDuplicate(error);
        if (refusal) return { kind: "refused", refusal };
        throw error;
      }
      if (!outcome.decision.ok) return { kind: "refused", refusal: outcome.decision };
      options.onChange?.();
      return { kind: "ok", result: { accepted: outcome.decision.result.accepted, clubName, clubTag } };
    },

    async confirmActivity(request) {
      return change(
        request,
        () => ({}),
        (state) => decideConfirmActivity(state),
      );
    },

    async deleteClub(request, confirmTag) {
      return change(
        request,
        () => ({}),
        (state) => decideDelete(state, confirmTag),
      );
    },
  };
}
