// SQL of club management (docs/adr/0012): the state a change touches, read under locks, the plan of a decision
// (rules.ts) applied in the same transaction, and what My Club and the lifecycle job read. Locks are taken in one
// order — the mode row, club rows, roster, invitations, player state, rejoin blocks — before anything is written, so
// two changes of one club wait for each other instead of racing; a deadlock, or a scope that moved between the two
// reads, repeats the change (twice at most). The indexes (one club per player, unique name, tag and club id, one
// open invitation per club and player) stay the last guard.

import { normalizeText } from "@ms/shared/text";
import type { ClubSettingsValue } from "@ms/shared/clubs";
import type { Database, Queries, Row } from "../../db/database.ts";
import { sql, t, type Statement } from "../../db/sql.ts";
import { normalizeDiscordId } from "../../lib/discord-id.ts";
import { isDeadlock } from "../../lib/sql-errors.ts";
import {
  DAY_MS,
  type ClubMember,
  type ClubState,
  type ClubUpdate,
  type Decision,
  type InvitationState,
  type InvitationStatus,
  type JoinBlockState,
  type LockedState,
  type PlanStep,
  type PlayerState,
} from "./rules.ts";

/** The rows attached to a club, deleted with it (C2); the club row itself goes last. */
const CLUB_ATTACHMENT_DELETES: readonly { readonly table: string; readonly column: string }[] = [
  { table: "_PlayerLobby", column: "Club" },
  { table: "ClubInvitation", column: "ClubId" },
  { table: "ClubJoinBlock", column: "ClubId" },
  { table: "ClubLogo", column: "ClubId" },
];

// ---------------------------------------------------------------------------------------------------
// Rows: NOT NULL where the schema says so (the newer club tables' columns are taken as nullable), legacy values
// normalized by the mappers below. The records of a batch's result sets extend Row, the type sets() returns.

/** dbo.Club as CLUB_COLUMNS reads it, for toClubState. */
export interface ClubStateRecord extends Row {
  ID: number;
  PublicId: string;
  ClubName: string;
  ClanTag: string;
  Owner: string;
  IsOpen: boolean;
  Region: string | null;
  Region2: string | null;
  Region3: string | null;
  ClubCode: string | null;
  ClubCode2: string | null;
  ClubCode3: string | null;
  Color1: string;
  Color2: string;
  Stadium: string | null;
  DiscordServer: string | null;
  Logo: string | null;
  Activity: Date | null;
  CreatedAtUtc: Date | null;
  EstablishedAtUtc: Date | null;
  StreakSinceUtc: Date | null;
  InactiveSinceUtc: Date | null;
  InactiveWarnedAtUtc: Date | null;
  DeletionWarnedAtUtc: Date | null;
}

export type SettingsRecord = Pick<
  ClubStateRecord,
  | "IsOpen"
  | "Region"
  | "Region2"
  | "Region3"
  | "ClubCode"
  | "ClubCode2"
  | "ClubCode3"
  | "Color1"
  | "Color2"
  | "Stadium"
  | "DiscordServer"
>;

/** A roster row with its player (MEMBER_COLUMNS). */
export interface MemberRecord extends Row {
  Player: number;
  Club: number;
  IsOfficer: boolean;
  JoinedAtUtc: Date | null;
  AbsentSinceUtc: Date | null;
  AbsenceExempt: boolean;
  DiscordID: string;
  Name: string;
  Country: string | null;
}

/** An invitation (INVITATION_COLUMNS). */
export interface InvitationRecord extends Row {
  Id: number;
  ClubId: number | null;
  PlayerId: number | null;
  InvitedByPlayerId: number | null;
  Status: string | null;
  CreatedAtUtc: Date | null;
  ExpiresAtUtc: Date | null;
}

/** A player with their dbo.ClubPlayerState (LEFT JOIN), for a PlayerState. */
export interface PlayerStateRecord extends Row {
  ID: number;
  DiscordID: string;
  Name: string;
  Country: string | null;
  LastClubCreatedAtUtc: Date | null;
  LastClubExitAtUtc: Date | null;
}

export interface JoinBlockRecord extends Row {
  ClubId: number | null;
  PlayerId: number | null;
  BlockedUntilUtc: Date | null;
}

export interface ModeRecord {
  Mode: string | null;
  GoLiveAtUtc: Date | null;
}

/** The clubs of the actor and of the invitation; NULL when there is none. */
export interface ScopeRecord {
  actor_club: number | null;
  invitation_club: number | null;
}

/** CONVERT(INT, SCOPE_IDENTITY()) after an insert. */
export interface IdRecord {
  id: number | null;
}

export interface AdminClubRecord {
  club_id: number;
  public_id: string;
  name: string;
  tag: string;
  logo: string | null;
  logo_hash: string | null;
  members: number;
}

function ms(value: unknown): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

const flag = (value: unknown): boolean => value === true || value === 1;
const compact = (values: readonly unknown[]): string[] => values.map(normalizeText).filter(Boolean);

const CLUB_COLUMNS = sql`
  c.ID, c.PublicId, c.ClubName, c.ClanTag, c.Owner, c.IsOpen, c.Region, c.Region2, c.Region3, c.ClubCode,
  c.ClubCode2, c.ClubCode3, c.Color1, c.Color2, c.Stadium, c.DiscordServer, c.Logo, c.Activity, c.CreatedAtUtc,
  c.EstablishedAtUtc, c.StreakSinceUtc, c.InactiveSinceUtc, c.InactiveWarnedAtUtc, c.DeletionWarnedAtUtc`;

const MEMBER_COLUMNS = sql`
  cr.Player, cr.Club, cr.IsOfficer, cr.JoinedAtUtc, cr.AbsentSinceUtc, cr.AbsenceExempt, p.DiscordID, p.Name,
  p.Country`;

const INVITATION_COLUMNS = sql`
  i.Id, i.ClubId, i.PlayerId, i.InvitedByPlayerId, i.Status, i.CreatedAtUtc, i.ExpiresAtUtc`;

export function toSettings(row: SettingsRecord): ClubSettingsValue {
  return {
    isOpen: flag(row.IsOpen),
    regions: compact([row.Region, row.Region2, row.Region3]),
    clubCodes: compact([row.ClubCode, row.ClubCode2, row.ClubCode3]),
    firstUniform: normalizeText(row.Color1),
    secondUniform: normalizeText(row.Color2),
    stadium: normalizeText(row.Stadium),
    discordUrl: normalizeText(row.DiscordServer),
  };
}

export function toMember(row: MemberRecord): ClubMember {
  return {
    playerId: row.Player,
    discordId: normalizeDiscordId(row.DiscordID) || normalizeText(row.DiscordID),
    name: normalizeText(row.Name) || "Unknown",
    country: normalizeText(row.Country).toLowerCase(),
    isOfficer: flag(row.IsOfficer),
    joinedAt: ms(row.JoinedAtUtc),
    absentSince: ms(row.AbsentSinceUtc),
    absenceExempt: flag(row.AbsenceExempt),
  };
}

export function toClubState(row: ClubStateRecord, members: readonly ClubMember[]): ClubState {
  return {
    clubId: row.ID,
    publicId: normalizeText(row.PublicId),
    name: normalizeText(row.ClubName),
    tag: normalizeText(row.ClanTag),
    ownerDiscordId: normalizeDiscordId(row.Owner),
    settings: toSettings(row),
    createdAt: ms(row.CreatedAtUtc),
    establishedAt: ms(row.EstablishedAtUtc),
    streakSince: ms(row.StreakSinceUtc),
    inactiveSince: ms(row.InactiveSinceUtc),
    inactiveWarnedAt: ms(row.InactiveWarnedAtUtc),
    deletionWarnedAt: ms(row.DeletionWarnedAtUtc),
    activity: ms(row.Activity),
    members,
  };
}

function toInvitation(row: InvitationRecord): InvitationState {
  return {
    id: row.Id,
    clubId: Number(row.ClubId),
    playerId: Number(row.PlayerId),
    invitedByPlayerId: Number(row.InvitedByPlayerId),
    status: normalizeText(row.Status) as InvitationStatus,
    createdAt: ms(row.CreatedAtUtc) ?? 0,
    expiresAt: ms(row.ExpiresAtUtc) ?? 0,
  };
}

// ---------------------------------------------------------------------------------------------------
// Reading a change's state under locks

export interface ChangeScope {
  readonly actorPlayerId: number;
  /** A club the change touches besides the actor's own (the one joined). */
  readonly clubId?: number;
  /** An invitation the change answers or revokes; its club is locked too. */
  readonly invitationId?: number;
  /** The other player of the change (the invitee, the member acted on). */
  readonly targetPlayerId?: number;
  /** A creation: also read every club name and tag. */
  readonly names?: boolean;
}

export interface ChangeExtras {
  /** clubNameKey() of every club name and tag (a creation only). */
  readonly names: ReadonlySet<string>;
  readonly tags: ReadonlySet<string>;
  /**
   * dbo.ClubSystemState.Mode, read in the change's own transaction with a shared lock held to its end: a switch of
   * the mode waits for running changes, and a change after the switch sees it (the service's cache gates reads only).
   */
  readonly mode: ClubSystemRow["mode"];
}

class StaleScope extends Error {}

/** Ids as an IN list; for none, -1 stands in (it matches no row, and `IN ()` is no SQL). */
const idList = (ids: readonly number[]): Statement => sql.list((ids.length ? ids : [-1]).map((id) => t.int(id)));

/** The locking read: the mode row, clubs, roster, invitations, player states and rejoin blocks, in this order. */
export function buildLockedStateQuery(scope: ChangeScope, clubIds: readonly number[], now: number): Statement {
  const clubs = idList(clubIds);
  return sql`
    DECLARE @actor INT = ${t.int(scope.actorPlayerId)};
    DECLARE @target INT = ${t.int(scope.targetPlayerId ?? -1)};
    SELECT TOP 1 Mode FROM dbo.ClubSystemState WITH (HOLDLOCK) WHERE Id = 1;
    SELECT ${CLUB_COLUMNS}
    FROM dbo.Club c WITH (UPDLOCK, HOLDLOCK)
    WHERE c.ID IN (${clubs})
    ORDER BY c.ID;
    SELECT ${MEMBER_COLUMNS}
    FROM dbo.ClubRoster cr WITH (UPDLOCK, HOLDLOCK)
    INNER JOIN dbo.Player p ON p.ID = cr.Player
    WHERE cr.Club IN (${clubs}) OR cr.Player IN (@actor, @target);
    SELECT ${INVITATION_COLUMNS}
    FROM dbo.ClubInvitation i WITH (UPDLOCK, HOLDLOCK)
    WHERE (i.ClubId IN (${clubs}) AND (i.Status = 'open' OR i.CreatedAtUtc >= ${t.dateTime2(now - 14 * DAY_MS, 0)}))
      OR (i.PlayerId IN (@actor, @target) AND i.Status = 'open');
    SELECT p.ID, p.DiscordID, p.Name, p.Country, s.LastClubCreatedAtUtc, s.LastClubExitAtUtc
    FROM dbo.Player p
    LEFT JOIN dbo.ClubPlayerState s WITH (UPDLOCK, HOLDLOCK) ON s.PlayerId = p.ID
    WHERE p.ID IN (@actor, @target);
    SELECT b.ClubId, b.PlayerId, b.BlockedUntilUtc
    FROM dbo.ClubJoinBlock b WITH (UPDLOCK, HOLDLOCK)
    WHERE b.PlayerId IN (@actor, @target);
  `;
}

async function readLockedState(
  tx: Queries,
  scope: ChangeScope,
  now: number,
  keyOf: (value: string) => string,
): Promise<{ state: LockedState; extras: ChangeExtras }> {
  // Unlocked: which clubs the locking read takes.
  const resolved = await tx.row<ScopeRecord>(sql`
    SELECT
      (SELECT TOP 1 Club FROM dbo.ClubRoster WHERE Player = ${t.int(scope.actorPlayerId)}) AS actor_club,
      (SELECT TOP 1 ClubId FROM dbo.ClubInvitation WHERE Id = ${t.int(scope.invitationId ?? -1)}) AS invitation_club;
  `);
  const clubIds = [
    ...new Set(
      [resolved?.actor_club, resolved?.invitation_club, scope.clubId]
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  ].sort((a, b) => a - b);

  const [modeRows, clubRows, memberRows, invitationRows, playerRows, blockRows] = (await tx.sets(
    buildLockedStateQuery(scope, clubIds, now),
  )) as [
    Pick<ModeRecord, "Mode">[],
    ClubStateRecord[],
    MemberRecord[],
    InvitationRecord[],
    PlayerStateRecord[],
    JoinBlockRecord[],
  ];
  const storedMode = normalizeText(modeRows[0]?.Mode);
  const mode: ClubSystemRow["mode"] = storedMode === "admins" || storedMode === "on" ? storedMode : "off";

  const members = memberRows.map((row) => ({ row, member: toMember(row) }));
  const clubs = new Map<number, ClubState>();
  for (const row of clubRows) {
    const clubId = row.ID;
    clubs.set(
      clubId,
      toClubState(
        row,
        members.filter((entry) => entry.row.Club === clubId).map((entry) => entry.member),
      ),
    );
  }
  const clubOf = (playerId: number): number | null => {
    const entry = members.find((candidate) => candidate.member.playerId === playerId);
    return entry ? entry.row.Club : null;
  };
  const player = (playerId: number): PlayerState | null => {
    const row = playerRows.find((candidate) => candidate.ID === playerId);
    if (!row) return null;
    return {
      playerId,
      discordId: normalizeDiscordId(row.DiscordID) || normalizeText(row.DiscordID),
      name: normalizeText(row.Name),
      country: normalizeText(row.Country).toLowerCase(),
      clubId: clubOf(playerId),
      lastClubCreatedAt: ms(row.LastClubCreatedAtUtc),
      lastClubExitAt: ms(row.LastClubExitAtUtc),
    };
  };
  const actor = player(scope.actorPlayerId);
  if (!actor) throw new Error(`Player ${String(scope.actorPlayerId)} not found.`);
  // The actor joined or left a club between the two reads: read again with that club locked.
  if (actor.clubId !== null && !clubs.has(actor.clubId)) throw new StaleScope();

  let extras: ChangeExtras = { names: new Set(), tags: new Set(), mode };
  if (scope.names) {
    const rows = await tx.rows<Pick<ClubStateRecord, "ClubName" | "ClanTag">>(
      sql`SELECT ClubName, ClanTag FROM dbo.Club;`,
    );
    extras = {
      names: new Set(rows.map((row) => keyOf(normalizeText(row.ClubName)))),
      tags: new Set(rows.map((row) => keyOf(normalizeText(row.ClanTag)))),
      mode,
    };
  }
  const joinBlocks: JoinBlockState[] = blockRows.map((row) => ({
    clubId: Number(row.ClubId),
    playerId: Number(row.PlayerId),
    until: ms(row.BlockedUntilUtc) ?? 0,
  }));
  return {
    state: {
      now,
      actor,
      target: scope.targetPlayerId === undefined ? null : player(scope.targetPlayerId),
      clubs,
      invitations: invitationRows.map(toInvitation),
      joinBlocks,
    },
    extras,
  };
}

// ---------------------------------------------------------------------------------------------------
// Applying a plan

export interface Created {
  readonly clubId?: number;
  readonly invitationId?: number;
}

/** The settings as dbo.Club's columns, each value in its column's type. */
function settingsColumns(settings: ClubSettingsValue) {
  const [region1 = "", region2 = null, region3 = null] = settings.regions;
  const [code1 = null, code2 = null, code3 = null] = settings.clubCodes;
  return {
    IsOpen: t.bit(settings.isOpen),
    Region: t.nvarchar(region1, 10),
    Region2: t.nvarchar(region2, 10),
    Region3: t.nvarchar(region3, 10),
    ClubCode: t.nvarchar(code1, 10),
    ClubCode2: t.nvarchar(code2, 7),
    ClubCode3: t.nvarchar(code3, 7),
    Color1: t.nvarchar(settings.firstUniform, 10),
    Color2: t.nvarchar(settings.secondUniform, 10),
    Stadium: t.nvarchar(settings.stadium || null, 50),
    DiscordServer: t.nvarchar(settings.discordUrl || null, 100),
  };
}

/** The SET list of a club update: exactly the columns `set` names; null when it names none. */
export function buildClubUpdate(set: ClubUpdate): Statement | null {
  const assignments: Statement[] = [];
  const time = (column: string, key: keyof ClubUpdate, value: number | null | undefined): void => {
    if (key in set) assignments.push(sql`${sql.raw(column)} = ${t.dateTime2(value ?? null, 0)}`);
  };
  if (set.name !== undefined) assignments.push(sql`ClubName = ${t.nvarchar(set.name, 50)}`);
  if (set.tag !== undefined) assignments.push(sql`ClanTag = ${t.nvarchar(set.tag, 5)}`);
  if (set.ownerDiscordId !== undefined) assignments.push(sql`Owner = ${t.nvarchar(set.ownerDiscordId, 25)}`);
  if (set.settings) {
    for (const [column, value] of Object.entries(settingsColumns(set.settings))) {
      assignments.push(sql`${sql.raw(column)} = ${value}`);
    }
  }
  if ("logo" in set) assignments.push(sql`Logo = ${t.nvarchar(set.logo ?? null, 4000)}`);
  time("Activity", "activity", set.activity);
  time("EstablishedAtUtc", "establishedAt", set.establishedAt);
  time("StreakSinceUtc", "streakSince", set.streakSince);
  time("InactiveSinceUtc", "inactiveSince", set.inactiveSince);
  time("InactiveWarnedAtUtc", "inactiveWarnedAt", set.inactiveWarnedAt);
  time("DeletionWarnedAtUtc", "deletionWarnedAt", set.deletionWarnedAt);
  return assignments.length ? sql.join(assignments) : null;
}

/** Deletes the rows attached to the club the batch's @club names. */
const DELETE_CLUB_ATTACHMENTS = sql.join(
  CLUB_ATTACHMENT_DELETES.map(
    ({ table, column }) => sql`DELETE FROM dbo.${sql.raw(table)} WHERE ${sql.raw(column)} = @club;`,
  ),
  " ",
);

async function applyPlan(tx: Queries, plan: readonly PlanStep[], now: number): Promise<Created> {
  let clubId: number | undefined;
  let invitationId: number | undefined;
  const club = (ref: number | { readonly ref: string }): number => {
    if (typeof ref === "number") return ref;
    if (clubId === undefined) throw new Error("The plan refers to a club it has not created.");
    return clubId;
  };
  const at = t.dateTime2(now, 0);
  for (const step of plan) {
    switch (step.kind) {
      case "createClub": {
        const row = step.club;
        const settings = settingsColumns(row.settings);
        const created = await tx.row<IdRecord>(sql`
          INSERT INTO dbo.Club (PublicId, ClubName, ClanTag, Owner, IsOpen, Region, Region2, Region3, ClubCode,
            ClubCode2, ClubCode3, Color1, Color2, Stadium, DiscordServer, Activity, CreatedAtUtc, EstablishedAtUtc)
          VALUES (${t.char(row.publicId, 8)}, ${t.nvarchar(row.name, 50)}, ${t.nvarchar(row.tag, 5)},
            ${t.nvarchar(row.ownerDiscordId, 25)}, ${settings.IsOpen}, ${settings.Region}, ${settings.Region2},
            ${settings.Region3}, ${settings.ClubCode}, ${settings.ClubCode2}, ${settings.ClubCode3}, ${settings.Color1},
            ${settings.Color2}, ${settings.Stadium}, ${settings.DiscordServer}, ${t.dateTime2(row.activity, 0)},
            ${t.dateTime2(row.createdAt, 0)}, NULL);
          SELECT CONVERT(INT, SCOPE_IDENTITY()) AS id;
        `);
        clubId = Number(created?.id);
        if (!Number.isInteger(clubId) || clubId <= 0) throw new Error("The new club got no id.");
        break;
      }
      case "updateClub": {
        const assignments = buildClubUpdate(step.set);
        if (!assignments) break;
        await tx.execute(sql`UPDATE dbo.Club SET ${assignments} WHERE ID = ${t.int(step.clubId)};`);
        break;
      }
      case "deleteClub":
        // Lobby rows, invitations, rejoin blocks, logo, members, the club.
        await tx.execute(sql`
          DECLARE @club INT = ${t.int(step.clubId)};
          ${DELETE_CLUB_ATTACHMENTS}
          DELETE FROM dbo.ClubRoster WHERE Club = @club;
          DELETE FROM dbo.Club WHERE ID = @club;
        `);
        break;
      case "addMember":
        await tx.execute(sql`
          DECLARE @club INT = ${t.int(club(step.clubId))};
          INSERT INTO dbo.ClubRoster (Player, Club, IsOfficer, Rank, JoinedAtUtc)
          SELECT ${t.int(step.playerId)}, @club, ${t.bit(step.isOfficer)}, ISNULL(MAX(Rank), -1) + 1, ${at}
          FROM dbo.ClubRoster
          WHERE Club = @club;
        `);
        break;
      case "updateMember": {
        const assignments: Statement[] = [];
        if (step.set.isOfficer !== undefined) assignments.push(sql`IsOfficer = ${t.bit(step.set.isOfficer)}`);
        if ("absentSince" in step.set) {
          assignments.push(sql`AbsentSinceUtc = ${t.dateTime2(step.set.absentSince ?? null, 0)}`);
        }
        if (step.set.absenceExempt !== undefined) {
          assignments.push(sql`AbsenceExempt = ${t.bit(step.set.absenceExempt)}`);
        }
        if (!assignments.length) break;
        await tx.execute(
          sql`UPDATE dbo.ClubRoster SET ${sql.join(assignments)} WHERE Player = ${t.int(step.playerId)};`,
        );
        break;
      }
      case "removeMember":
        await tx.execute(sql`DELETE FROM dbo.ClubRoster WHERE Player = ${t.int(step.playerId)};`);
        break;
      case "setPlayerState":
        await tx.execute(sql`
          DECLARE @player INT = ${t.int(step.playerId)};
          DECLARE @created DATETIME2(0) = ${t.dateTime2(step.set.lastClubCreatedAt ?? null, 0)};
          DECLARE @exit DATETIME2(0) = ${t.dateTime2(step.set.lastClubExitAt ?? null, 0)};
          UPDATE dbo.ClubPlayerState SET LastClubCreatedAtUtc = ISNULL(@created, LastClubCreatedAtUtc),
            LastClubExitAtUtc = ISNULL(@exit, LastClubExitAtUtc)
          WHERE PlayerId = @player;
          IF @@ROWCOUNT = 0
            INSERT INTO dbo.ClubPlayerState (PlayerId, LastClubCreatedAtUtc, LastClubExitAtUtc)
            VALUES (@player, @created, @exit);
        `);
        break;
      case "setJoinBlock":
        await tx.execute(sql`
          DECLARE @club INT = ${t.int(step.clubId)};
          DECLARE @player INT = ${t.int(step.playerId)};
          DECLARE @until DATETIME2(0) = ${t.dateTime2(step.until, 0)};
          UPDATE dbo.ClubJoinBlock SET BlockedUntilUtc = @until WHERE ClubId = @club AND PlayerId = @player;
          IF @@ROWCOUNT = 0
            INSERT INTO dbo.ClubJoinBlock (ClubId, PlayerId, BlockedUntilUtc) VALUES (@club, @player, @until);
        `);
        break;
      case "liftJoinBlock":
        await tx.execute(sql`
          DELETE FROM dbo.ClubJoinBlock WHERE ClubId = ${t.int(step.clubId)} AND PlayerId = ${t.int(step.playerId)};
        `);
        break;
      case "invite": {
        const created = await tx.row<IdRecord>(sql`
          INSERT INTO dbo.ClubInvitation (ClubId, PlayerId, InvitedByPlayerId, Status, CreatedAtUtc, ExpiresAtUtc)
          VALUES (${t.int(step.clubId)}, ${t.int(step.playerId)}, ${t.int(step.invitedByPlayerId)}, 'open', ${at},
            ${t.dateTime2(step.expiresAt, 0)});
          SELECT CONVERT(INT, SCOPE_IDENTITY()) AS id;
        `);
        invitationId = Number(created?.id);
        if (!Number.isInteger(invitationId) || invitationId <= 0) throw new Error("The new invitation got no id.");
        break;
      }
      case "closeInvitations": {
        const [closed = 0] = await tx.execute(sql`
          UPDATE dbo.ClubInvitation SET Status = ${t.varchar(step.status, 10)}, ClosedAtUtc = ${at}
          WHERE Status = 'open' AND Id IN (${idList(step.ids)});
        `);
        if (closed !== step.ids.length)
          throw new Error(`Expected ${step.ids.length} open invitations, closed ${closed}.`);
        break;
      }
      case "event": {
        const { event } = step;
        const eventClubId = club(event.clubId);
        const payload = {
          ...event.payload,
          club: { ...event.payload.club, id: eventClubId },
          invitation:
            event.payload.invitation && event.newInvitation
              ? { ...event.payload.invitation, id: invitationId ?? null }
              : event.payload.invitation,
        };
        await tx.execute(sql`
          INSERT INTO dbo.ClubEvent (Type, ClubId, ClubPublicId, ClubName, ClubTag, ActorPlayerId, TargetPlayerId,
            Payload, CreatedAtUtc)
          VALUES (${t.varchar(event.type, 40)}, ${t.int(eventClubId)}, ${t.char(event.clubPublicId || null, 8)},
            ${t.nvarchar(event.clubName || null, 50)}, ${t.nvarchar(event.clubTag || null, 5)},
            ${t.int(event.actorPlayerId)}, ${t.int(event.targetPlayerId)}, ${t.nvarcharMax(JSON.stringify(payload))},
            ${at});
        `);
        break;
      }
      case "setLogo":
        await tx.execute(sql`
          DECLARE @club INT = ${t.int(step.clubId)};
          DECLARE @type VARCHAR(20) = ${t.varchar(step.logo.contentType, 20)};
          DECLARE @hash CHAR(64) = ${t.char(step.logo.hash, 64)};
          DECLARE @width INT = ${t.int(step.logo.width)};
          DECLARE @height INT = ${t.int(step.logo.height)};
          DECLARE @data VARBINARY(MAX) = ${t.varBinary(Buffer.from(step.logo.data))};
          DECLARE @now DATETIME2(0) = ${at};
          UPDATE dbo.ClubLogo SET ContentType = @type, Hash = @hash, Width = @width, Height = @height, Data = @data,
            UpdatedAtUtc = @now
          WHERE ClubId = @club;
          IF @@ROWCOUNT = 0
            INSERT INTO dbo.ClubLogo (ClubId, ContentType, Hash, Width, Height, Data, UpdatedAtUtc)
            VALUES (@club, @type, @hash, @width, @height, @data, @now);
        `);
        break;
      case "removeLogo":
        await tx.execute(sql`DELETE FROM dbo.ClubLogo WHERE ClubId = ${t.int(step.clubId)};`);
        break;
      case "log":
        await tx.execute(sql`
          INSERT INTO dbo.CommandLog (Command, Parameters)
          VALUES (${t.nvarchar(step.command, 100)}, ${t.nvarchar(JSON.stringify(step.parameters).slice(0, 4000), 4000)});
        `);
        break;
    }
  }
  return { ...(clubId === undefined ? {} : { clubId }), ...(invitationId === undefined ? {} : { invitationId }) };
}

// ---------------------------------------------------------------------------------------------------
// The store

export interface ClubSystemRow {
  readonly mode: "off" | "admins" | "on";
  readonly goLiveAt: number | null;
}

export interface MyClubRow {
  readonly player: PlayerState | null;
  readonly club: (ClubState & { readonly logoUrl: string; readonly logoHash: string }) | null;
  /** The club's open invitations (with the invitee's name), for its captain and officers. */
  readonly clubInvitations: readonly (InvitationState & {
    readonly playerName: string;
    readonly invitedByName: string;
  })[];
  /** Open invitations to the player, with their club. */
  readonly invitations: readonly (InvitationState & {
    readonly clubName: string;
    readonly clubTag: string;
    readonly invitedByName: string;
  })[];
  readonly joinBlocks: readonly JoinBlockState[];
}

/** A club as the Admin Panel lists it (B2): its backend id (F1) and whether it has a logo. */
export interface AdminClubRow {
  readonly clubId: number;
  readonly publicId: string;
  readonly name: string;
  readonly tag: string;
  readonly members: number;
  /** An uploaded logo or a logo link. */
  readonly hasLogo: boolean;
}

export interface CandidateRow {
  readonly playerId: number;
  readonly discordId: string;
  readonly name: string;
  readonly country: string;
}

export interface ClubStore {
  readMode(): Promise<ClubSystemRow>;
  /** The Discord id of a player; "" when there is no such player. */
  discordIdOf(playerId: number): Promise<string>;
  /** The player of a Discord id; null when there is none. */
  playerIdOf(discordId: string): Promise<number | null>;
  /**
   * One transaction: locks and reads what the change touches, lets `decide` answer, applies its plan. A deadlock or
   * a scope that moved meanwhile repeats it, twice at most.
   */
  change<T>(
    scope: ChangeScope,
    now: number,
    decide: (state: LockedState, extras: ChangeExtras) => Decision<T>,
  ): Promise<{ readonly decision: Decision<T>; readonly created: Created }>;
  /** A change of one club by the lifecycle job; false when the club is gone or nothing was to do. */
  changeClub(
    clubId: number,
    now: number,
    decide: (state: Pick<LockedState, "now" | "invitations">, club: ClubState) => readonly PlanStep[],
  ): Promise<boolean>;
  readMyClub(playerId: number, now: number): Promise<MyClubRow>;
  /** Players with a profile and no club, and the club's invitations of the last 14 days. */
  inviteCandidates(
    clubId: number,
    now: number,
  ): Promise<{
    readonly players: readonly CandidateRow[];
    readonly invitations: readonly InvitationState[];
  }>;
  /** The lifecycle job's reads and its plain statements. */
  newClubIds(): Promise<number[]>;
  expireInvitations(
    now: number,
    decide: (
      invitations: readonly InvitationState[],
      clubOf: (id: number) => ClubState | undefined,
    ) => readonly PlanStep[],
  ): Promise<number>;
  rosterPresence(): Promise<readonly { readonly clubId: number; readonly member: ClubMember }[]>;
  /** Every club for the Admin Panel, by name. */
  adminClubs(): Promise<readonly AdminClubRow[]>;
  /** L2: raises Club.Activity to the newest rated match a current member played since `since`; returns the clubs. */
  raiseMatchActivity(since: number): Promise<number>;
  /** Rows of clubs that no longer exist, and invitations closed long ago; returns the rows removed. */
  cleanUp(now: number): Promise<number>;
}

export function createSqlClubStore(database: Database, keyOf: (value: string) => string): ClubStore {
  // The store repeats a change itself, not with the core's `retries`: a scope that moved meanwhile repeats it too.
  async function attempt<T>(work: () => Promise<T>): Promise<T> {
    for (let round = 0; ; round += 1) {
      try {
        return await work();
      } catch (error) {
        if (round < 2 && (isDeadlock(error) || error instanceof StaleScope)) continue;
        throw error;
      }
    }
  }

  return {
    async readMode() {
      try {
        const row = await database.row<ModeRecord>(
          sql`SELECT TOP 1 Mode, GoLiveAtUtc FROM dbo.ClubSystemState WHERE Id = 1;`,
        );
        const mode = normalizeText(row?.Mode);
        return { mode: mode === "admins" || mode === "on" ? mode : "off", goLiveAt: ms(row?.GoLiveAtUtc) };
      } catch {
        // No mode row (a database before the club schema) or no database: closed.
        return { mode: "off", goLiveAt: null };
      }
    },

    async discordIdOf(playerId) {
      const row = await database.row<Pick<PlayerStateRecord, "DiscordID">>(
        sql`SELECT TOP 1 DiscordID FROM dbo.Player WHERE ID = ${t.int(playerId)};`,
      );
      return normalizeDiscordId(row?.DiscordID);
    },

    async playerIdOf(discordId) {
      const row = await database.row<Pick<PlayerStateRecord, "ID">>(
        sql`SELECT TOP 1 ID FROM dbo.Player WHERE DiscordID = ${t.nvarchar(discordId, 25)} ORDER BY ID;`,
      );
      const playerId = Number(row?.ID);
      return Number.isInteger(playerId) && playerId > 0 ? playerId : null;
    },

    change(scope, now, decide) {
      return attempt(() =>
        database.transaction(async (tx) => {
          const { state, extras } = await readLockedState(tx, scope, now, keyOf);
          const decision = decide(state, extras);
          const created = decision.ok ? await applyPlan(tx, decision.plan, now) : {};
          return { decision, created };
        }),
      );
    },

    changeClub(clubId, now, decide) {
      return attempt(() =>
        database.transaction(async (tx) => {
          const [clubRows, memberRows, invitationRows] = (await tx.sets(sql`
            DECLARE @club INT = ${t.int(clubId)};
            SELECT ${CLUB_COLUMNS} FROM dbo.Club c WITH (UPDLOCK, HOLDLOCK) WHERE c.ID = @club;
            SELECT ${MEMBER_COLUMNS}
            FROM dbo.ClubRoster cr WITH (UPDLOCK, HOLDLOCK)
            INNER JOIN dbo.Player p ON p.ID = cr.Player
            WHERE cr.Club = @club;
            SELECT ${INVITATION_COLUMNS}
            FROM dbo.ClubInvitation i WITH (UPDLOCK, HOLDLOCK)
            WHERE i.ClubId = @club AND i.Status = 'open';
          `)) as [ClubStateRecord[], MemberRecord[], InvitationRecord[]];
          const row = clubRows[0];
          if (!row) return false;
          const steps = decide(
            { now, invitations: invitationRows.map(toInvitation) },
            toClubState(row, memberRows.map(toMember)),
          );
          if (!steps.length) return false;
          await applyPlan(tx, steps, now);
          return true;
        }),
      );
    },

    async readMyClub(playerId, now) {
      const batch = sql`
        DECLARE @player INT = ${t.int(playerId)};
        DECLARE @now DATETIME2(0) = ${t.dateTime2(now, 0)};
        DECLARE @club INT = (SELECT TOP 1 Club FROM dbo.ClubRoster WHERE Player = @player);
        SELECT p.ID, p.DiscordID, p.Name, p.Country, s.LastClubCreatedAtUtc, s.LastClubExitAtUtc, @club AS Club
        FROM dbo.Player p
        LEFT JOIN dbo.ClubPlayerState s ON s.PlayerId = p.ID
        WHERE p.ID = @player;
        SELECT ${CLUB_COLUMNS}, l.Hash AS LogoHash
        FROM dbo.Club c
        LEFT JOIN dbo.ClubLogo l ON l.ClubId = c.ID
        WHERE c.ID = @club;
        SELECT ${MEMBER_COLUMNS}
        FROM dbo.ClubRoster cr
        INNER JOIN dbo.Player p ON p.ID = cr.Player
        WHERE cr.Club = @club;
        SELECT ${INVITATION_COLUMNS}, p.Name AS PlayerName, b.Name AS InvitedByName
        FROM dbo.ClubInvitation i
        LEFT JOIN dbo.Player p ON p.ID = i.PlayerId
        LEFT JOIN dbo.Player b ON b.ID = i.InvitedByPlayerId
        WHERE i.ClubId = @club AND i.Status = 'open'
        ORDER BY i.CreatedAtUtc;
        SELECT ${INVITATION_COLUMNS}, c.ClubName, c.ClanTag, b.Name AS InvitedByName
        FROM dbo.ClubInvitation i
        INNER JOIN dbo.Club c ON c.ID = i.ClubId
        LEFT JOIN dbo.Player b ON b.ID = i.InvitedByPlayerId
        WHERE i.PlayerId = @player AND i.Status = 'open' AND i.ExpiresAtUtc > @now
        ORDER BY i.CreatedAtUtc;
        SELECT b.ClubId, b.PlayerId, b.BlockedUntilUtc
        FROM dbo.ClubJoinBlock b
        WHERE b.PlayerId = @player AND b.BlockedUntilUtc > @now;
      `;
      const [playerRows, clubRows, memberRows, clubInvitationRows, invitationRows, blockRows] = (await database.sets(
        batch,
      )) as [
        (PlayerStateRecord & { Club: number | null })[],
        (ClubStateRecord & { LogoHash: string | null })[],
        MemberRecord[],
        (InvitationRecord & { PlayerName: string | null; InvitedByName: string | null })[],
        (InvitationRecord & { ClubName: string; ClanTag: string; InvitedByName: string | null })[],
        JoinBlockRecord[],
      ];
      const playerRow = playerRows[0];
      const clubRow = clubRows[0];
      const club = clubRow
        ? {
            ...toClubState(clubRow, memberRows.map(toMember)),
            logoUrl: normalizeText(clubRow.Logo),
            logoHash: normalizeText(clubRow.LogoHash),
          }
        : null;
      return {
        player: playerRow
          ? {
              playerId,
              discordId: normalizeDiscordId(playerRow.DiscordID) || normalizeText(playerRow.DiscordID),
              name: normalizeText(playerRow.Name),
              country: normalizeText(playerRow.Country).toLowerCase(),
              clubId: club?.clubId ?? null,
              lastClubCreatedAt: ms(playerRow.LastClubCreatedAtUtc),
              lastClubExitAt: ms(playerRow.LastClubExitAtUtc),
            }
          : null,
        club,
        clubInvitations: clubInvitationRows.map((row) => ({
          ...toInvitation(row),
          playerName: normalizeText(row.PlayerName),
          invitedByName: normalizeText(row.InvitedByName),
        })),
        invitations: invitationRows.map((row) => ({
          ...toInvitation(row),
          clubName: normalizeText(row.ClubName),
          clubTag: normalizeText(row.ClanTag),
          invitedByName: normalizeText(row.InvitedByName),
        })),
        joinBlocks: blockRows.map((row) => ({
          clubId: Number(row.ClubId),
          playerId: Number(row.PlayerId),
          until: ms(row.BlockedUntilUtc) ?? 0,
        })),
      };
    },

    async inviteCandidates(clubId, now) {
      const [playerRows, invitationRows] = (await database.sets(sql`
        SELECT p.ID, p.DiscordID, p.Name, p.Country
        FROM dbo.Player p
        WHERE NOT EXISTS (SELECT 1 FROM dbo.ClubRoster cr WHERE cr.Player = p.ID);
        SELECT ${INVITATION_COLUMNS}
        FROM dbo.ClubInvitation i
        WHERE i.ClubId = ${t.int(clubId)}
          AND (i.Status = 'open' OR i.CreatedAtUtc >= ${t.dateTime2(now - 14 * DAY_MS, 0)});
      `)) as [Pick<PlayerStateRecord, "ID" | "DiscordID" | "Name" | "Country">[], InvitationRecord[]];
      return {
        players: playerRows.map((row) => ({
          playerId: row.ID,
          discordId: normalizeDiscordId(row.DiscordID) || normalizeText(row.DiscordID),
          name: normalizeText(row.Name),
          country: normalizeText(row.Country).toLowerCase(),
        })),
        invitations: invitationRows.map(toInvitation),
      };
    },

    async newClubIds() {
      const rows = await database.rows<Pick<ClubStateRecord, "ID">>(
        sql`SELECT ID FROM dbo.Club WHERE EstablishedAtUtc IS NULL;`,
      );
      return rows.map((row) => row.ID);
    },

    expireInvitations(now, decide) {
      return attempt(() =>
        database.transaction(async (tx) => {
          const rows = await tx.rows<InvitationRecord>(sql`
            SELECT ${INVITATION_COLUMNS}
            FROM dbo.ClubInvitation i WITH (UPDLOCK, HOLDLOCK)
            WHERE i.Status = 'open' AND i.ExpiresAtUtc <= ${t.dateTime2(now, 0)};
          `);
          const invitations = rows.map(toInvitation);
          if (!invitations.length) return 0;
          const clubIds = [...new Set(invitations.map((invitation) => invitation.clubId))];
          const clubRows = await tx.rows<ClubStateRecord>(
            sql`SELECT ${CLUB_COLUMNS} FROM dbo.Club c WHERE c.ID IN (${idList(clubIds)});`,
          );
          const clubs = new Map(clubRows.map((row) => [row.ID, toClubState(row, [])]));
          const steps = decide(invitations, (id) => clubs.get(id));
          await applyPlan(tx, steps, now);
          return invitations.length;
        }),
      );
    },

    async rosterPresence() {
      const rows = await database.rows<MemberRecord>(
        sql`SELECT ${MEMBER_COLUMNS} FROM dbo.ClubRoster cr INNER JOIN dbo.Player p ON p.ID = cr.Player;`,
      );
      return rows.map((row) => ({ clubId: row.Club, member: toMember(row) }));
    },

    async adminClubs() {
      // B2: every club with its backend id, its members and its logo (uploaded or a link), by name.
      const rows = await database.rows<AdminClubRecord>(sql`
        SELECT c.ID AS club_id, c.PublicId AS public_id, c.ClubName AS name, c.ClanTag AS tag, c.Logo AS logo,
          l.Hash AS logo_hash, (SELECT COUNT(*) FROM dbo.ClubRoster cr WHERE cr.Club = c.ID) AS members
        FROM dbo.Club c
        LEFT JOIN dbo.ClubLogo l ON l.ClubId = c.ID
        ORDER BY c.ClubName, c.ID;
      `);
      return rows.map((row) => ({
        clubId: row.club_id,
        publicId: normalizeText(row.public_id),
        name: normalizeText(row.name),
        tag: normalizeText(row.tag),
        members: row.members,
        hasLogo: Boolean(normalizeText(row.logo_hash) || normalizeText(row.logo)),
      }));
    },

    async raiseMatchActivity(since) {
      // The newest completed rated match of each club's current members, counted from `since` and, for a member
      // who joined later, from the join. Club.Activity only ever moves forward.
      const [changed = 0] = await database.execute(sql`
        ;WITH latest AS (
          SELECT cr.Club, MAX(m.CompletedAtUtc) AS LastMatch
          FROM dbo.ClubRoster cr
          INNER JOIN rocci121_toby.RatedMatchParticipant mp ON mp.PlayerId = cr.Player
          INNER JOIN rocci121_toby.RatedMatch m ON m.Id = mp.RatedMatchId
          WHERE m.Status = 'completed' AND m.CompletedAtUtc >= ${t.dateTime2(since, 3)}
            AND (cr.JoinedAtUtc IS NULL OR m.CompletedAtUtc >= cr.JoinedAtUtc)
          GROUP BY cr.Club)
        UPDATE c SET Activity = CONVERT(DATETIME2(0), l.LastMatch)
        FROM dbo.Club c
        INNER JOIN latest l ON l.Club = c.ID
        WHERE c.Activity IS NULL OR c.Activity < CONVERT(DATETIME2(0), l.LastMatch);
      `);
      return changed;
    },

    async cleanUp(now) {
      // Rows of clubs that no longer exist (the bot deletes clubs until go-live), and invitations closed 30 days ago.
      const removed = await database.execute(sql`
        DECLARE @before DATETIME2(0) = ${t.dateTime2(now - 30 * DAY_MS, 0)};
        DELETE i FROM dbo.ClubInvitation i
        WHERE NOT EXISTS (SELECT 1 FROM dbo.Club c WHERE c.ID = i.ClubId)
          OR (i.Status <> 'open' AND i.ClosedAtUtc < @before);
        DELETE b FROM dbo.ClubJoinBlock b
        WHERE b.BlockedUntilUtc < ${t.dateTime2(now, 0)} OR NOT EXISTS (SELECT 1 FROM dbo.Club c WHERE c.ID = b.ClubId);
        DELETE l FROM dbo.ClubLogo l WHERE NOT EXISTS (SELECT 1 FROM dbo.Club c WHERE c.ID = l.ClubId);
        DELETE FROM dbo.ClubEvent WHERE ProcessedAtUtc < @before;
      `);
      return removed.reduce((total, count) => total + count, 0);
    },
  };
}
