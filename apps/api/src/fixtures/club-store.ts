// Club management's store in memory (modules/clubs/management-repository.ts has the SQL one): the fixtures of local
// development and the service tests. It reads the same state and applies the same plans, without a database; the
// events and CommandLog lines a change writes are kept for the tests to inspect.

import type { ClubSettingsValue } from "@ms/shared/clubs";
import type {
  CandidateRow,
  ChangeExtras,
  ChangeScope,
  ClubStore,
  ClubSystemRow,
  Created,
  MyClubRow,
} from "../modules/clubs/management-repository.ts";
import {
  DAY_MS,
  type ClubEventDraft,
  type ClubMember,
  type ClubState,
  type Decision,
  type InvitationState,
  type JoinBlockState,
  type LockedState,
  type PlanStep,
  type PlayerState,
} from "../modules/clubs/rules.ts";

export interface MemoryClub {
  clubId: number;
  publicId: string;
  name: string;
  tag: string;
  ownerDiscordId: string;
  settings: ClubSettingsValue;
  logoUrl: string;
  createdAt: number | null;
  establishedAt: number | null;
  streakSince: number | null;
  inactiveSince: number | null;
  inactiveWarnedAt: number | null;
  deletionWarnedAt: number | null;
  activity: number | null;
}

export interface MemoryPlayer {
  playerId: number;
  discordId: string;
  name: string;
  country: string;
}

interface RosterEntry {
  clubId: number;
  isOfficer: boolean;
  rank: number;
  joinedAt: number | null;
  absentSince: number | null;
  absenceExempt: boolean;
}

export interface MemoryClubStore extends ClubStore {
  mode: ClubSystemRow;
  readonly clubs: Map<number, MemoryClub>;
  readonly players: Map<number, MemoryPlayer>;
  readonly events: (Omit<ClubEventDraft, "clubId"> & {
    readonly clubId: number;
    readonly invitationId: number | null;
  })[];
  readonly logs: { readonly command: string; readonly parameters: Readonly<Record<string, unknown>> }[];
  /** Puts a player into a club, as the bot or an earlier change did. */
  addMember(
    clubId: number,
    playerId: number,
    options?: { readonly isOfficer?: boolean; readonly joinedAt?: number | null },
  ): void;
  memberClub(playerId: number): number | null;
  invitations(): readonly InvitationState[];
}

export function createMemoryClubStore(
  seed: {
    readonly clubs?: readonly MemoryClub[];
    readonly players?: readonly MemoryPlayer[];
    readonly mode?: ClubSystemRow;
    readonly keyOf?: (value: string) => string;
  } = {},
): MemoryClubStore {
  const keyOf = seed.keyOf ?? ((value: string) => value.trim().toUpperCase());
  const clubs = new Map((seed.clubs ?? []).map((club) => [club.clubId, { ...club }]));
  const players = new Map((seed.players ?? []).map((player) => [player.playerId, { ...player }]));
  const roster = new Map<number, RosterEntry>();
  const playerStates = new Map<number, { lastClubCreatedAt: number | null; lastClubExitAt: number | null }>();
  let invitations: InvitationState[] = [];
  let joinBlocks: JoinBlockState[] = [];
  const events: MemoryClubStore["events"] = [];
  const logs: MemoryClubStore["logs"] = [];
  let nextClubId = Math.max(1000, ...[...clubs.keys()].map((id) => id + 1));
  let nextInvitationId = 1;

  const memberOf = (playerId: number, entry: RosterEntry): ClubMember => {
    const player = players.get(playerId);
    return {
      playerId,
      discordId: player?.discordId ?? "",
      name: player?.name ?? "Unknown",
      country: player?.country ?? "",
      isOfficer: entry.isOfficer,
      joinedAt: entry.joinedAt,
      absentSince: entry.absentSince,
      absenceExempt: entry.absenceExempt,
    };
  };

  const clubState = (club: MemoryClub): ClubState => ({
    clubId: club.clubId,
    publicId: club.publicId,
    name: club.name,
    tag: club.tag,
    ownerDiscordId: club.ownerDiscordId,
    settings: club.settings,
    createdAt: club.createdAt,
    establishedAt: club.establishedAt,
    streakSince: club.streakSince,
    inactiveSince: club.inactiveSince,
    inactiveWarnedAt: club.inactiveWarnedAt,
    deletionWarnedAt: club.deletionWarnedAt,
    activity: club.activity,
    members: [...roster.entries()]
      .filter(([, entry]) => entry.clubId === club.clubId)
      .map(([playerId, entry]) => memberOf(playerId, entry)),
  });

  const playerState = (playerId: number): PlayerState | null => {
    const player = players.get(playerId);
    if (!player) return null;
    const state = playerStates.get(playerId);
    return {
      playerId,
      discordId: player.discordId,
      name: player.name,
      country: player.country,
      clubId: roster.get(playerId)?.clubId ?? null,
      lastClubCreatedAt: state?.lastClubCreatedAt ?? null,
      lastClubExitAt: state?.lastClubExitAt ?? null,
    };
  };

  function apply(plan: readonly PlanStep[], now: number): Created {
    let clubId: number | undefined;
    let invitationId: number | undefined;
    const club = (ref: number | { readonly ref: string }): number => {
      if (typeof ref === "number") return ref;
      if (clubId === undefined) throw new Error("The plan refers to a club it has not created.");
      return clubId;
    };
    for (const step of plan) {
      switch (step.kind) {
        case "createClub": {
          // The unique indexes of dbo.Club (UX_Club_ClubName, IX_Club on the tag).
          if ([...clubs.values()].some((entry) => keyOf(entry.name) === keyOf(step.club.name))) {
            throw Object.assign(
              new Error("Cannot insert duplicate key row in object 'dbo.Club' with unique index 'UX_Club_ClubName'."),
              { number: 2601 },
            );
          }
          if ([...clubs.values()].some((entry) => keyOf(entry.tag) === keyOf(step.club.tag))) {
            throw Object.assign(
              new Error("Cannot insert duplicate key row in object 'dbo.Club' with unique index 'IX_Club'."),
              { number: 2601 },
            );
          }
          clubId = nextClubId++;
          clubs.set(clubId, {
            clubId,
            publicId: step.club.publicId,
            name: step.club.name,
            tag: step.club.tag,
            ownerDiscordId: step.club.ownerDiscordId,
            settings: step.club.settings,
            logoUrl: "",
            createdAt: step.club.createdAt,
            establishedAt: null,
            streakSince: null,
            inactiveSince: null,
            inactiveWarnedAt: null,
            deletionWarnedAt: null,
            activity: step.club.activity,
          });
          break;
        }
        case "updateClub": {
          const target = clubs.get(step.clubId);
          if (!target) break;
          const { set } = step;
          if (set.name !== undefined) target.name = set.name;
          if (set.tag !== undefined) target.tag = set.tag;
          if (set.ownerDiscordId !== undefined) target.ownerDiscordId = set.ownerDiscordId;
          if (set.settings) target.settings = set.settings;
          if ("logo" in set) target.logoUrl = set.logo ?? "";
          if (set.activity !== undefined) target.activity = set.activity;
          if ("establishedAt" in set) target.establishedAt = set.establishedAt ?? null;
          if ("streakSince" in set) target.streakSince = set.streakSince ?? null;
          if ("inactiveSince" in set) target.inactiveSince = set.inactiveSince ?? null;
          if ("inactiveWarnedAt" in set) target.inactiveWarnedAt = set.inactiveWarnedAt ?? null;
          if ("deletionWarnedAt" in set) target.deletionWarnedAt = set.deletionWarnedAt ?? null;
          break;
        }
        case "deleteClub":
          clubs.delete(step.clubId);
          for (const [playerId, entry] of roster) if (entry.clubId === step.clubId) roster.delete(playerId);
          invitations = invitations.filter((invitation) => invitation.clubId !== step.clubId);
          joinBlocks = joinBlocks.filter((block) => block.clubId !== step.clubId);
          break;
        case "addMember": {
          if (roster.has(step.playerId)) {
            throw Object.assign(
              new Error(
                "Violation of PRIMARY KEY constraint 'PK_ClubRoster'. Cannot insert duplicate key in object 'dbo.ClubRoster'.",
              ),
              { number: 2627 },
            );
          }
          const target = club(step.clubId);
          const ranks = [...roster.values()].filter((entry) => entry.clubId === target).map((entry) => entry.rank);
          roster.set(step.playerId, {
            clubId: target,
            isOfficer: step.isOfficer,
            rank: ranks.length ? Math.max(...ranks) + 1 : 0,
            joinedAt: now,
            absentSince: null,
            absenceExempt: false,
          });
          break;
        }
        case "updateMember": {
          const entry = roster.get(step.playerId);
          if (!entry) break;
          if (step.set.isOfficer !== undefined) entry.isOfficer = step.set.isOfficer;
          if ("absentSince" in step.set) entry.absentSince = step.set.absentSince ?? null;
          if (step.set.absenceExempt !== undefined) entry.absenceExempt = step.set.absenceExempt;
          break;
        }
        case "removeMember":
          roster.delete(step.playerId);
          break;
        case "setPlayerState": {
          const current = playerStates.get(step.playerId) ?? { lastClubCreatedAt: null, lastClubExitAt: null };
          playerStates.set(step.playerId, {
            lastClubCreatedAt: step.set.lastClubCreatedAt ?? current.lastClubCreatedAt,
            lastClubExitAt: step.set.lastClubExitAt ?? current.lastClubExitAt,
          });
          break;
        }
        case "setJoinBlock":
          joinBlocks = [
            ...joinBlocks.filter((block) => !(block.clubId === step.clubId && block.playerId === step.playerId)),
            { clubId: step.clubId, playerId: step.playerId, until: step.until },
          ];
          break;
        case "liftJoinBlock":
          joinBlocks = joinBlocks.filter(
            (block) => !(block.clubId === step.clubId && block.playerId === step.playerId),
          );
          break;
        case "invite":
          invitationId = nextInvitationId++;
          invitations.push({
            id: invitationId,
            clubId: step.clubId,
            playerId: step.playerId,
            invitedByPlayerId: step.invitedByPlayerId,
            status: "open",
            createdAt: now,
            expiresAt: step.expiresAt,
          });
          break;
        case "closeInvitations": {
          const ids = new Set(step.ids);
          const open = invitations.filter((invitation) => ids.has(invitation.id) && invitation.status === "open");
          if (open.length !== step.ids.length) throw new Error(`Expected ${step.ids.length} open invitations.`);
          invitations = invitations.map((invitation) =>
            ids.has(invitation.id) ? { ...invitation, status: step.status } : invitation,
          );
          break;
        }
        case "event": {
          const id = club(step.event.clubId);
          const newInvitation = step.event.newInvitation ? (invitationId ?? null) : null;
          events.push({
            ...step.event,
            clubId: id,
            invitationId: newInvitation ?? step.event.payload.invitation?.id ?? null,
            payload: {
              ...step.event.payload,
              club: { ...step.event.payload.club, id },
              invitation:
                step.event.payload.invitation && step.event.newInvitation
                  ? { ...step.event.payload.invitation, id: newInvitation }
                  : step.event.payload.invitation,
            },
          });
          break;
        }
        case "log":
          logs.push({ command: step.command, parameters: step.parameters });
          break;
      }
    }
    return { ...(clubId === undefined ? {} : { clubId }), ...(invitationId === undefined ? {} : { invitationId }) };
  }

  function lockedState(scope: ChangeScope, now: number): LockedState {
    const ids = new Set<number>();
    const own = roster.get(scope.actorPlayerId)?.clubId;
    if (own !== undefined) ids.add(own);
    if (scope.clubId !== undefined) ids.add(scope.clubId);
    const invitation = invitations.find((entry) => entry.id === scope.invitationId);
    if (invitation) ids.add(invitation.clubId);
    const locked = new Map<number, ClubState>();
    for (const id of ids) {
      const entry = clubs.get(id);
      if (entry) locked.set(id, clubState(entry));
    }
    const people = new Set([scope.actorPlayerId, scope.targetPlayerId ?? -1]);
    const actor = playerState(scope.actorPlayerId);
    if (!actor) throw new Error(`Player ${String(scope.actorPlayerId)} not found.`);
    return {
      now,
      actor,
      target: scope.targetPlayerId === undefined ? null : playerState(scope.targetPlayerId),
      clubs: locked,
      invitations: invitations.filter(
        (entry) =>
          (ids.has(entry.clubId) && (entry.status === "open" || entry.createdAt >= now - 14 * DAY_MS)) ||
          (people.has(entry.playerId) && entry.status === "open"),
      ),
      joinBlocks: joinBlocks.filter((block) => people.has(block.playerId)),
    };
  }

  const store: MemoryClubStore = {
    mode: seed.mode ?? { mode: "on", goLiveAt: null },
    clubs,
    players,
    events,
    logs,

    addMember(clubId, playerId, options = {}) {
      const ranks = [...roster.values()].filter((entry) => entry.clubId === clubId).map((entry) => entry.rank);
      roster.set(playerId, {
        clubId,
        isOfficer: options.isOfficer ?? false,
        rank: ranks.length ? Math.max(...ranks) + 1 : 0,
        joinedAt: options.joinedAt ?? null,
        absentSince: null,
        absenceExempt: false,
      });
    },
    memberClub: (playerId) => roster.get(playerId)?.clubId ?? null,
    invitations: () => invitations,

    readMode: () => Promise.resolve(store.mode),
    discordIdOf: (playerId) => Promise.resolve(players.get(playerId)?.discordId ?? ""),
    playerIdOf: (discordId) =>
      Promise.resolve([...players.values()].find((player) => player.discordId === discordId)?.playerId ?? null),

    change<T>(scope: ChangeScope, now: number, decide: (state: LockedState, extras: ChangeExtras) => Decision<T>) {
      const state = lockedState(scope, now);
      const extras: ChangeExtras = scope.names
        ? {
            names: new Set([...clubs.values()].map((club) => keyOf(club.name))),
            tags: new Set([...clubs.values()].map((club) => keyOf(club.tag))),
          }
        : { names: new Set(), tags: new Set() };
      const decision = decide(state, extras);
      try {
        const created = decision.ok ? apply(decision.plan, now) : {};
        return Promise.resolve({ decision, created });
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },

    changeClub(clubId, now, decide) {
      const entry = clubs.get(clubId);
      if (!entry) return Promise.resolve(false);
      const steps = decide(
        {
          now,
          invitations: invitations.filter((invitation) => invitation.clubId === clubId && invitation.status === "open"),
        },
        clubState(entry),
      );
      if (!steps.length) return Promise.resolve(false);
      apply(steps, now);
      return Promise.resolve(true);
    },

    readMyClub(playerId, now): Promise<MyClubRow> {
      const player = playerState(playerId);
      const clubId = roster.get(playerId)?.clubId;
      const entry = clubId === undefined ? undefined : clubs.get(clubId);
      const name = (id: number): string => players.get(id)?.name ?? "";
      return Promise.resolve({
        player,
        club: entry ? { ...clubState(entry), logoUrl: entry.logoUrl, logoHash: "" } : null,
        clubInvitations: invitations
          .filter((invitation) => invitation.clubId === clubId && invitation.status === "open")
          .map((invitation) => ({
            ...invitation,
            playerName: name(invitation.playerId),
            invitedByName: name(invitation.invitedByPlayerId),
          })),
        invitations: invitations
          .filter(
            (invitation) =>
              invitation.playerId === playerId && invitation.status === "open" && invitation.expiresAt > now,
          )
          .map((invitation) => ({
            ...invitation,
            clubName: clubs.get(invitation.clubId)?.name ?? "",
            clubTag: clubs.get(invitation.clubId)?.tag ?? "",
            invitedByName: name(invitation.invitedByPlayerId),
          })),
        joinBlocks: joinBlocks.filter((block) => block.playerId === playerId && block.until > now),
      });
    },

    inviteCandidates(clubId, now) {
      const candidates: CandidateRow[] = [...players.values()]
        .filter((player) => !roster.has(player.playerId))
        .map((player) => ({ ...player }));
      return Promise.resolve({
        players: candidates,
        invitations: invitations.filter(
          (invitation) =>
            invitation.clubId === clubId && (invitation.status === "open" || invitation.createdAt >= now - 14 * DAY_MS),
        ),
      });
    },

    newClubIds: () =>
      Promise.resolve([...clubs.values()].filter((club) => club.establishedAt === null).map((club) => club.clubId)),

    expireInvitations(now, decide) {
      const expired = invitations.filter((invitation) => invitation.status === "open" && invitation.expiresAt <= now);
      if (!expired.length) return Promise.resolve(0);
      apply(
        decide(expired, (id) => {
          const entry = clubs.get(id);
          return entry ? clubState(entry) : undefined;
        }),
        now,
      );
      return Promise.resolve(expired.length);
    },

    rosterPresence: () =>
      Promise.resolve(
        [...roster.entries()].map(([playerId, entry]) => ({ clubId: entry.clubId, member: memberOf(playerId, entry) })),
      ),
    raiseMatchActivity: () => Promise.resolve(0),
    cleanUp: () => Promise.resolve(0),
  };
  return store;
}
