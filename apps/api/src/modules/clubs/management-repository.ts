// SQL of club management (docs/adr/0012): the state a change touches, read under locks, the plan of a decision
// (rules.ts) applied in the same transaction, and what My Club and the lifecycle job read. Locks are taken in one
// order — club rows, roster, invitations, player state, rejoin blocks — and every change starts with the club rows,
// so two changes of one club wait for each other instead of racing; a deadlock retries the change once. The
// indexes (one club per player, unique name, tag and club id, one open invitation per club and player) stay the
// last guard.

import { normalizeText } from "@ms/shared/text";
import type { ClubSettingsValue } from "@ms/shared/clubs";
import type { Database, Queryable } from "../../db/database.ts";
import { mssql } from "../../db/database.ts";
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
import { CLUB_ATTACHMENT_DELETES } from "./schema.ts";

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------------------------------
// Rows

function recordsets(result: { recordsets?: unknown }): Row[][] {
  return Array.isArray(result.recordsets) ? (result.recordsets as Row[][]) : [];
}

function rowsOf(result: { recordset?: unknown }): Row[] {
  return Array.isArray(result.recordset) ? (result.recordset as Row[]) : [];
}

function ms(value: unknown): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

const flag = (value: unknown): boolean => value === true || value === 1;
const compact = (values: readonly unknown[]): string[] => values.map(normalizeText).filter(Boolean);

export const CLUB_COLUMNS_SQL = [
  "c.ID, c.PublicId, c.ClubName, c.ClanTag, c.Owner, c.IsOpen, c.Region, c.Region2, c.Region3,",
  "c.ClubCode, c.ClubCode2, c.ClubCode3, c.Color1, c.Color2, c.Stadium, c.DiscordServer, c.Logo, c.Activity,",
  "c.CreatedAtUtc, c.EstablishedAtUtc, c.StreakSinceUtc, c.InactiveSinceUtc, c.InactiveWarnedAtUtc,",
  "c.DeletionWarnedAtUtc",
].join(" ");

const MEMBER_COLUMNS_SQL =
  "cr.Player, cr.Club, cr.IsOfficer, cr.JoinedAtUtc, cr.AbsentSinceUtc, cr.AbsenceExempt, p.DiscordID, p.Name, p.Country";

export function toSettings(row: Row): ClubSettingsValue {
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

export function toMember(row: Row): ClubMember {
  return {
    playerId: Number(row.Player),
    discordId: normalizeDiscordId(row.DiscordID) || normalizeText(row.DiscordID),
    name: normalizeText(row.Name) || "Unknown",
    country: normalizeText(row.Country).toLowerCase(),
    isOfficer: flag(row.IsOfficer),
    joinedAt: ms(row.JoinedAtUtc),
    absentSince: ms(row.AbsentSinceUtc),
    absenceExempt: flag(row.AbsenceExempt),
  };
}

export function toClubState(row: Row, members: readonly ClubMember[]): ClubState {
  return {
    clubId: Number(row.ID),
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

function toInvitation(row: Row): InvitationState {
  return {
    id: Number(row.Id),
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

const idList = (ids: readonly number[]): string =>
  ids.length ? ids.map((id) => String(Math.trunc(id))).join(", ") : "-1";

export const SCOPE_QUERY = [
  "SELECT (SELECT TOP 1 Club FROM dbo.ClubRoster WHERE Player = @actor) AS actor_club,",
  "  (SELECT TOP 1 ClubId FROM dbo.ClubInvitation WHERE Id = @invitation) AS invitation_club;",
].join(" ");

/** The locking read: the mode row, clubs, roster, invitations, player states and rejoin blocks, in this order. */
export function buildLockedStateQuery(clubIds: readonly number[]): string {
  const clubs = idList(clubIds);
  return [
    "SET XACT_ABORT ON;",
    "SELECT TOP 1 Mode FROM dbo.ClubSystemState WITH (HOLDLOCK) WHERE Id = 1;",
    `SELECT ${CLUB_COLUMNS_SQL} FROM dbo.Club c WITH (UPDLOCK, HOLDLOCK) WHERE c.ID IN (${clubs}) ORDER BY c.ID;`,
    `SELECT ${MEMBER_COLUMNS_SQL} FROM dbo.ClubRoster cr WITH (UPDLOCK, HOLDLOCK)`,
    `INNER JOIN dbo.Player p ON p.ID = cr.Player WHERE cr.Club IN (${clubs}) OR cr.Player IN (@actor, @target);`,
    "SELECT i.Id, i.ClubId, i.PlayerId, i.InvitedByPlayerId, i.Status, i.CreatedAtUtc, i.ExpiresAtUtc",
    "FROM dbo.ClubInvitation i WITH (UPDLOCK, HOLDLOCK)",
    `WHERE (i.ClubId IN (${clubs}) AND (i.Status = 'open' OR i.CreatedAtUtc >= @since))`,
    "  OR (i.PlayerId IN (@actor, @target) AND i.Status = 'open');",
    "SELECT p.ID, p.DiscordID, p.Name, p.Country, s.LastClubCreatedAtUtc, s.LastClubExitAtUtc",
    "FROM dbo.Player p LEFT JOIN dbo.ClubPlayerState s WITH (UPDLOCK, HOLDLOCK) ON s.PlayerId = p.ID",
    "WHERE p.ID IN (@actor, @target);",
    "SELECT b.ClubId, b.PlayerId, b.BlockedUntilUtc FROM dbo.ClubJoinBlock b WITH (UPDLOCK, HOLDLOCK)",
    "WHERE b.PlayerId IN (@actor, @target);",
  ].join(" ");
}

export const NAMES_QUERY = "SELECT ClubName, ClanTag FROM dbo.Club;";

async function readLockedState(
  tx: Queryable,
  scope: ChangeScope,
  now: number,
  keyOf: (value: string) => string,
): Promise<{ state: LockedState; extras: ChangeExtras }> {
  const target = scope.targetPlayerId ?? -1;
  const lookup = tx.request();
  lookup.input("actor", mssql.Int, scope.actorPlayerId);
  lookup.input("invitation", mssql.Int, scope.invitationId ?? -1);
  const resolved = rowsOf(await lookup.query(SCOPE_QUERY))[0] ?? {};
  const clubIds = [
    ...new Set(
      [resolved.actor_club, resolved.invitation_club, scope.clubId]
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  ].sort((a, b) => a - b);

  const request = tx.request();
  request.multiple = true;
  request.input("actor", mssql.Int, scope.actorPlayerId);
  request.input("target", mssql.Int, target);
  request.input("since", mssql.DateTime2(0), new Date(now - 14 * DAY_MS));
  const [modeRows = [], clubRows = [], memberRows = [], invitationRows = [], playerRows = [], blockRows = []] =
    recordsets(await request.query(buildLockedStateQuery(clubIds)));
  const storedMode = normalizeText(modeRows[0]?.Mode);
  const mode: ClubSystemRow["mode"] = storedMode === "admins" || storedMode === "on" ? storedMode : "off";

  const members = memberRows.map((row) => ({ row, member: toMember(row) }));
  const clubs = new Map<number, ClubState>();
  for (const row of clubRows) {
    const clubId = Number(row.ID);
    clubs.set(
      clubId,
      toClubState(
        row,
        members.filter((entry) => Number(entry.row.Club) === clubId).map((entry) => entry.member),
      ),
    );
  }
  const clubOf = (playerId: number): number | null => {
    const entry = members.find((candidate) => candidate.member.playerId === playerId);
    return entry ? Number(entry.row.Club) : null;
  };
  const player = (playerId: number): PlayerState | null => {
    const row = playerRows.find((candidate) => Number(candidate.ID) === playerId);
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
    const rows = rowsOf(await tx.request().query(NAMES_QUERY));
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

const date = (value: number | null | undefined): Date | null =>
  value === null || value === undefined ? null : new Date(value);

function settingsInputs(request: mssql.Request, settings: ClubSettingsValue): void {
  const [region1 = "", region2 = null, region3 = null] = settings.regions;
  const [code1 = null, code2 = null, code3 = null] = settings.clubCodes;
  request.input("isOpen", mssql.Bit, settings.isOpen);
  request.input("region1", mssql.NVarChar(10), region1);
  request.input("region2", mssql.NVarChar(10), region2);
  request.input("region3", mssql.NVarChar(10), region3);
  request.input("code1", mssql.NVarChar(10), code1);
  request.input("code2", mssql.NVarChar(7), code2);
  request.input("code3", mssql.NVarChar(7), code3);
  request.input("color1", mssql.NVarChar(10), settings.firstUniform);
  request.input("color2", mssql.NVarChar(10), settings.secondUniform);
  request.input("stadium", mssql.NVarChar(50), settings.stadium || null);
  request.input("discord", mssql.NVarChar(100), settings.discordUrl || null);
}

const SETTINGS_ASSIGNMENTS = [
  "IsOpen = @isOpen",
  "Region = @region1",
  "Region2 = @region2",
  "Region3 = @region3",
  "ClubCode = @code1",
  "ClubCode2 = @code2",
  "ClubCode3 = @code3",
  "Color1 = @color1",
  "Color2 = @color2",
  "Stadium = @stadium",
  "DiscordServer = @discord",
];

/** The SET list of an update; adds its parameters to `request`. */
export function buildClubUpdate(set: ClubUpdate, request: mssql.Request): string[] {
  const assignments: string[] = [];
  const time = (column: string, key: keyof ClubUpdate, value: number | null | undefined): void => {
    if (!(key in set)) return;
    request.input(key, mssql.DateTime2(0), date(value));
    assignments.push(`${column} = @${key}`);
  };
  if (set.name !== undefined) {
    request.input("name", mssql.NVarChar(50), set.name);
    assignments.push("ClubName = @name");
  }
  if (set.tag !== undefined) {
    request.input("tag", mssql.NVarChar(5), set.tag);
    assignments.push("ClanTag = @tag");
  }
  if (set.ownerDiscordId !== undefined) {
    request.input("owner", mssql.NVarChar(25), set.ownerDiscordId);
    assignments.push("Owner = @owner");
  }
  if (set.settings) {
    settingsInputs(request, set.settings);
    assignments.push(...SETTINGS_ASSIGNMENTS);
  }
  if ("logo" in set) {
    request.input("logo", mssql.NVarChar(4000), set.logo ?? null);
    assignments.push("Logo = @logo");
  }
  time("Activity", "activity", set.activity);
  time("EstablishedAtUtc", "establishedAt", set.establishedAt);
  time("StreakSinceUtc", "streakSince", set.streakSince);
  time("InactiveSinceUtc", "inactiveSince", set.inactiveSince);
  time("InactiveWarnedAtUtc", "inactiveWarnedAt", set.inactiveWarnedAt);
  time("DeletionWarnedAtUtc", "deletionWarnedAt", set.deletionWarnedAt);
  return assignments;
}

export const CREATE_CLUB_SQL = [
  "INSERT INTO dbo.Club (PublicId, ClubName, ClanTag, Owner, IsOpen, Region, Region2, Region3, ClubCode, ClubCode2,",
  "  ClubCode3, Color1, Color2, Stadium, DiscordServer, Activity, CreatedAtUtc, EstablishedAtUtc)",
  "VALUES (@publicId, @name, @tag, @owner, @isOpen, @region1, @region2, @region3, @code1, @code2, @code3, @color1,",
  "  @color2, @stadium, @discord, @activity, @createdAt, NULL);",
  "SELECT CONVERT(INT, SCOPE_IDENTITY()) AS id;",
].join(" ");

export const ADD_MEMBER_SQL = [
  "INSERT INTO dbo.ClubRoster (Player, Club, IsOfficer, Rank, JoinedAtUtc)",
  "SELECT @player, @club, @officer, ISNULL(MAX(Rank), -1) + 1, @now FROM dbo.ClubRoster WHERE Club = @club;",
].join(" ");

export const INVITE_SQL = [
  "INSERT INTO dbo.ClubInvitation (ClubId, PlayerId, InvitedByPlayerId, Status, CreatedAtUtc, ExpiresAtUtc)",
  "VALUES (@club, @player, @by, 'open', @now, @expires);",
  "SELECT CONVERT(INT, SCOPE_IDENTITY()) AS id;",
].join(" ");

export const PLAYER_STATE_SQL = [
  "UPDATE dbo.ClubPlayerState SET LastClubCreatedAtUtc = ISNULL(@created, LastClubCreatedAtUtc),",
  "  LastClubExitAtUtc = ISNULL(@exit, LastClubExitAtUtc) WHERE PlayerId = @player;",
  "IF @@ROWCOUNT = 0",
  "  INSERT INTO dbo.ClubPlayerState (PlayerId, LastClubCreatedAtUtc, LastClubExitAtUtc) VALUES (@player, @created, @exit);",
].join(" ");

export const JOIN_BLOCK_SQL = [
  "UPDATE dbo.ClubJoinBlock SET BlockedUntilUtc = @until WHERE ClubId = @club AND PlayerId = @player;",
  "IF @@ROWCOUNT = 0 INSERT INTO dbo.ClubJoinBlock (ClubId, PlayerId, BlockedUntilUtc) VALUES (@club, @player, @until);",
].join(" ");

export const EVENT_SQL = [
  "INSERT INTO dbo.ClubEvent (Type, ClubId, ClubPublicId, ClubName, ClubTag, ActorPlayerId, TargetPlayerId, Payload,",
  "  CreatedAtUtc) VALUES (@type, @club, @publicId, @name, @tag, @actor, @target, @payload, @now);",
].join(" ");

export const LOG_SQL = "INSERT INTO dbo.CommandLog (Command, Parameters) VALUES (@command, @parameters);";

export const SET_LOGO_SQL = [
  "UPDATE dbo.ClubLogo SET ContentType = @type, Hash = @hash, Width = @width, Height = @height, Data = @data,",
  "  UpdatedAtUtc = @now WHERE ClubId = @club;",
  "IF @@ROWCOUNT = 0",
  "  INSERT INTO dbo.ClubLogo (ClubId, ContentType, Hash, Width, Height, Data, UpdatedAtUtc)",
  "  VALUES (@club, @type, @hash, @width, @height, @data, @now);",
].join(" ");

/** Deletes a club with everything attached to it: lobby rows, invitations, rejoin blocks, logo, members. */
export const DELETE_CLUB_SQL = [
  ...CLUB_ATTACHMENT_DELETES.map(({ table, column }) => `DELETE FROM dbo.${table} WHERE ${column} = @club;`),
  "DELETE FROM dbo.ClubRoster WHERE Club = @club;",
  "DELETE FROM dbo.Club WHERE ID = @club;",
].join(" ");

function affected(result: { readonly rowsAffected?: readonly number[] }): number[] {
  return result.rowsAffected ? [...result.rowsAffected] : [];
}

async function applyPlan(tx: Queryable, plan: readonly PlanStep[], now: number): Promise<Created> {
  let clubId: number | undefined;
  let invitationId: number | undefined;
  const club = (ref: number | { readonly ref: string }): number => {
    if (typeof ref === "number") return ref;
    if (clubId === undefined) throw new Error("The plan refers to a club it has not created.");
    return clubId;
  };
  for (const step of plan) {
    const request = tx.request();
    request.input("now", mssql.DateTime2(0), new Date(now));
    switch (step.kind) {
      case "createClub": {
        const row = step.club;
        request.input("publicId", mssql.Char(8), row.publicId);
        request.input("name", mssql.NVarChar(50), row.name);
        request.input("tag", mssql.NVarChar(5), row.tag);
        request.input("owner", mssql.NVarChar(25), row.ownerDiscordId);
        settingsInputs(request, row.settings);
        request.input("activity", mssql.DateTime2(0), new Date(row.activity));
        request.input("createdAt", mssql.DateTime2(0), new Date(row.createdAt));
        clubId = Number(rowsOf(await request.query(CREATE_CLUB_SQL))[0]?.id);
        if (!Number.isInteger(clubId) || clubId <= 0) throw new Error("The new club got no id.");
        break;
      }
      case "updateClub": {
        const assignments = buildClubUpdate(step.set, request);
        if (!assignments.length) break;
        request.input("club", mssql.Int, step.clubId);
        await request.query(`UPDATE dbo.Club SET ${assignments.join(", ")} WHERE ID = @club;`);
        break;
      }
      case "deleteClub":
        request.input("club", mssql.Int, step.clubId);
        await request.query(DELETE_CLUB_SQL);
        break;
      case "addMember":
        request.input("player", mssql.Int, step.playerId);
        request.input("club", mssql.Int, club(step.clubId));
        request.input("officer", mssql.Bit, step.isOfficer);
        await request.query(ADD_MEMBER_SQL);
        break;
      case "updateMember": {
        const assignments: string[] = [];
        if (step.set.isOfficer !== undefined) {
          request.input("officer", mssql.Bit, step.set.isOfficer);
          assignments.push("IsOfficer = @officer");
        }
        if ("absentSince" in step.set) {
          request.input("absent", mssql.DateTime2(0), date(step.set.absentSince));
          assignments.push("AbsentSinceUtc = @absent");
        }
        if (step.set.absenceExempt !== undefined) {
          request.input("exempt", mssql.Bit, step.set.absenceExempt);
          assignments.push("AbsenceExempt = @exempt");
        }
        if (!assignments.length) break;
        request.input("player", mssql.Int, step.playerId);
        await request.query(`UPDATE dbo.ClubRoster SET ${assignments.join(", ")} WHERE Player = @player;`);
        break;
      }
      case "removeMember":
        request.input("player", mssql.Int, step.playerId);
        await request.query("DELETE FROM dbo.ClubRoster WHERE Player = @player;");
        break;
      case "setPlayerState":
        request.input("player", mssql.Int, step.playerId);
        request.input("created", mssql.DateTime2(0), date(step.set.lastClubCreatedAt));
        request.input("exit", mssql.DateTime2(0), date(step.set.lastClubExitAt));
        await request.query(PLAYER_STATE_SQL);
        break;
      case "setJoinBlock":
        request.input("club", mssql.Int, step.clubId);
        request.input("player", mssql.Int, step.playerId);
        request.input("until", mssql.DateTime2(0), new Date(step.until));
        await request.query(JOIN_BLOCK_SQL);
        break;
      case "liftJoinBlock":
        request.input("club", mssql.Int, step.clubId);
        request.input("player", mssql.Int, step.playerId);
        await request.query("DELETE FROM dbo.ClubJoinBlock WHERE ClubId = @club AND PlayerId = @player;");
        break;
      case "invite":
        request.input("club", mssql.Int, step.clubId);
        request.input("player", mssql.Int, step.playerId);
        request.input("by", mssql.Int, step.invitedByPlayerId);
        request.input("expires", mssql.DateTime2(0), new Date(step.expiresAt));
        invitationId = Number(rowsOf(await request.query(INVITE_SQL))[0]?.id);
        if (!Number.isInteger(invitationId) || invitationId <= 0) throw new Error("The new invitation got no id.");
        break;
      case "closeInvitations": {
        request.input("status", mssql.VarChar(10), step.status);
        const result = await request.query(
          "UPDATE dbo.ClubInvitation SET Status = @status, ClosedAtUtc = @now " +
            `WHERE Status = 'open' AND Id IN (${idList(step.ids)});`,
        );
        const [closed = 0] = affected(result);
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
        request.input("type", mssql.VarChar(40), event.type);
        request.input("club", mssql.Int, eventClubId);
        request.input("publicId", mssql.Char(8), event.clubPublicId || null);
        request.input("name", mssql.NVarChar(50), event.clubName || null);
        request.input("tag", mssql.NVarChar(5), event.clubTag || null);
        request.input("actor", mssql.Int, event.actorPlayerId);
        request.input("target", mssql.Int, event.targetPlayerId);
        request.input("payload", mssql.NVarChar(mssql.MAX), JSON.stringify(payload));
        await request.query(EVENT_SQL);
        break;
      }
      case "setLogo":
        request.input("club", mssql.Int, step.clubId);
        request.input("type", mssql.VarChar(20), step.logo.contentType);
        request.input("hash", mssql.Char(64), step.logo.hash);
        request.input("width", mssql.Int, step.logo.width);
        request.input("height", mssql.Int, step.logo.height);
        request.input("data", mssql.VarBinary(mssql.MAX), Buffer.from(step.logo.data));
        await request.query(SET_LOGO_SQL);
        break;
      case "removeLogo":
        request.input("club", mssql.Int, step.clubId);
        await request.query("DELETE FROM dbo.ClubLogo WHERE ClubId = @club;");
        break;
      case "log":
        request.input("command", mssql.NVarChar(100), step.command);
        request.input("parameters", mssql.NVarChar(4000), JSON.stringify(step.parameters).slice(0, 4000));
        await request.query(LOG_SQL);
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
   * a scope that moved meanwhile repeats it once.
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

export const MODE_QUERY = "SELECT TOP 1 Mode, GoLiveAtUtc FROM dbo.ClubSystemState WHERE Id = 1;";

export const MY_CLUB_QUERY = [
  "DECLARE @club INT = (SELECT TOP 1 Club FROM dbo.ClubRoster WHERE Player = @player);",
  "SELECT p.ID, p.DiscordID, p.Name, p.Country, s.LastClubCreatedAtUtc, s.LastClubExitAtUtc, @club AS Club",
  "FROM dbo.Player p LEFT JOIN dbo.ClubPlayerState s ON s.PlayerId = p.ID WHERE p.ID = @player;",
  `SELECT ${CLUB_COLUMNS_SQL}, l.Hash AS LogoHash FROM dbo.Club c LEFT JOIN dbo.ClubLogo l ON l.ClubId = c.ID`,
  "WHERE c.ID = @club;",
  `SELECT ${MEMBER_COLUMNS_SQL} FROM dbo.ClubRoster cr INNER JOIN dbo.Player p ON p.ID = cr.Player WHERE cr.Club = @club;`,
  "SELECT i.Id, i.ClubId, i.PlayerId, i.InvitedByPlayerId, i.Status, i.CreatedAtUtc, i.ExpiresAtUtc,",
  "  p.Name AS PlayerName, b.Name AS InvitedByName",
  "FROM dbo.ClubInvitation i LEFT JOIN dbo.Player p ON p.ID = i.PlayerId LEFT JOIN dbo.Player b ON b.ID = i.InvitedByPlayerId",
  "WHERE i.ClubId = @club AND i.Status = 'open' ORDER BY i.CreatedAtUtc;",
  "SELECT i.Id, i.ClubId, i.PlayerId, i.InvitedByPlayerId, i.Status, i.CreatedAtUtc, i.ExpiresAtUtc,",
  "  c.ClubName, c.ClanTag, b.Name AS InvitedByName",
  "FROM dbo.ClubInvitation i INNER JOIN dbo.Club c ON c.ID = i.ClubId LEFT JOIN dbo.Player b ON b.ID = i.InvitedByPlayerId",
  "WHERE i.PlayerId = @player AND i.Status = 'open' AND i.ExpiresAtUtc > @now ORDER BY i.CreatedAtUtc;",
  "SELECT b.ClubId, b.PlayerId, b.BlockedUntilUtc FROM dbo.ClubJoinBlock b WHERE b.PlayerId = @player AND b.BlockedUntilUtc > @now;",
].join(" ");

export const CANDIDATES_QUERY = [
  "SELECT p.ID, p.DiscordID, p.Name, p.Country FROM dbo.Player p",
  "WHERE NOT EXISTS (SELECT 1 FROM dbo.ClubRoster cr WHERE cr.Player = p.ID);",
  "SELECT i.Id, i.ClubId, i.PlayerId, i.InvitedByPlayerId, i.Status, i.CreatedAtUtc, i.ExpiresAtUtc",
  "FROM dbo.ClubInvitation i WHERE i.ClubId = @club AND (i.Status = 'open' OR i.CreatedAtUtc >= @since);",
].join(" ");

export const EXPIRED_INVITATIONS_QUERY = [
  "SELECT i.Id, i.ClubId, i.PlayerId, i.InvitedByPlayerId, i.Status, i.CreatedAtUtc, i.ExpiresAtUtc",
  "FROM dbo.ClubInvitation i WITH (UPDLOCK, HOLDLOCK) WHERE i.Status = 'open' AND i.ExpiresAtUtc <= @now;",
].join(" ");

/**
 * L2: the newest completed rated match of each club's current members, counted from `@since` and, for a member who
 * joined later, from the join. Club.Activity only ever moves forward.
 */
export const MATCH_ACTIVITY_SQL = [
  ";WITH latest AS (",
  "  SELECT cr.Club, MAX(m.CompletedAtUtc) AS LastMatch",
  "  FROM dbo.ClubRoster cr",
  "  INNER JOIN rocci121_toby.RatedMatchParticipant mp ON mp.PlayerId = cr.Player",
  "  INNER JOIN rocci121_toby.RatedMatch m ON m.Id = mp.RatedMatchId",
  "  WHERE m.Status = 'completed' AND m.CompletedAtUtc >= @since",
  "    AND (cr.JoinedAtUtc IS NULL OR m.CompletedAtUtc >= cr.JoinedAtUtc)",
  "  GROUP BY cr.Club)",
  "UPDATE c SET Activity = CONVERT(DATETIME2(0), l.LastMatch) FROM dbo.Club c INNER JOIN latest l ON l.Club = c.ID",
  "WHERE c.Activity IS NULL OR c.Activity < CONVERT(DATETIME2(0), l.LastMatch);",
].join(" ");

/** Rows of clubs that no longer exist (the bot deletes clubs until go-live), and invitations closed 30 days ago. */
/** B2: every club with its backend id, its members and its logo (uploaded or a link), by name. */
export const ADMIN_CLUBS_QUERY = [
  "SELECT c.ID AS club_id, c.PublicId AS public_id, c.ClubName AS name, c.ClanTag AS tag, c.Logo AS logo,",
  "  l.Hash AS logo_hash, (SELECT COUNT(*) FROM dbo.ClubRoster cr WHERE cr.Club = c.ID) AS members",
  "FROM dbo.Club c LEFT JOIN dbo.ClubLogo l ON l.ClubId = c.ID",
  "ORDER BY c.ClubName, c.ID;",
].join(" ");

export const CLEANUP_SQL = [
  "DELETE i FROM dbo.ClubInvitation i WHERE NOT EXISTS (SELECT 1 FROM dbo.Club c WHERE c.ID = i.ClubId)",
  "  OR (i.Status <> 'open' AND i.ClosedAtUtc < @before);",
  "DELETE b FROM dbo.ClubJoinBlock b WHERE b.BlockedUntilUtc < @now OR NOT EXISTS (SELECT 1 FROM dbo.Club c WHERE c.ID = b.ClubId);",
  "DELETE l FROM dbo.ClubLogo l WHERE NOT EXISTS (SELECT 1 FROM dbo.Club c WHERE c.ID = l.ClubId);",
  "DELETE FROM dbo.ClubEvent WHERE ProcessedAtUtc < @before;",
].join(" ");

export function createSqlClubStore(
  database: Pick<Database, "withPool" | "withTransaction">,
  keyOf: (value: string) => string,
): ClubStore {
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
        const row = await database.withPool(async (pool) => rowsOf(await pool.request().query(MODE_QUERY))[0]);
        const mode = normalizeText(row?.Mode);
        return { mode: mode === "admins" || mode === "on" ? mode : "off", goLiveAt: ms(row?.GoLiveAtUtc) };
      } catch {
        // No mode row (a database before the club schema) or no database: closed.
        return { mode: "off", goLiveAt: null };
      }
    },

    async discordIdOf(playerId) {
      const row = await database.withPool(async (pool) => {
        const request = pool.request();
        request.input("player", mssql.Int, playerId);
        return rowsOf(await request.query("SELECT TOP 1 DiscordID FROM dbo.Player WHERE ID = @player;"))[0];
      });
      return normalizeDiscordId(row?.DiscordID);
    },

    async playerIdOf(discordId) {
      const row = await database.withPool(async (pool) => {
        const request = pool.request();
        request.input("discordId", mssql.NVarChar(25), discordId);
        return rowsOf(
          await request.query("SELECT TOP 1 ID FROM dbo.Player WHERE DiscordID = @discordId ORDER BY ID;"),
        )[0];
      });
      const playerId = Number(row?.ID);
      return Number.isInteger(playerId) && playerId > 0 ? playerId : null;
    },

    change(scope, now, decide) {
      return attempt(() =>
        database.withTransaction(async (tx) => {
          const { state, extras } = await readLockedState(tx, scope, now, keyOf);
          const decision = decide(state, extras);
          const created = decision.ok ? await applyPlan(tx, decision.plan, now) : {};
          return { decision, created };
        }),
      );
    },

    changeClub(clubId, now, decide) {
      return attempt(() =>
        database.withTransaction(async (tx) => {
          const request = tx.request();
          request.multiple = true;
          request.input("club", mssql.Int, clubId);
          const [clubRows = [], memberRows = [], invitationRows = []] = recordsets(
            await request.query(
              [
                "SET XACT_ABORT ON;",
                `SELECT ${CLUB_COLUMNS_SQL} FROM dbo.Club c WITH (UPDLOCK, HOLDLOCK) WHERE c.ID = @club;`,
                `SELECT ${MEMBER_COLUMNS_SQL} FROM dbo.ClubRoster cr WITH (UPDLOCK, HOLDLOCK)`,
                "INNER JOIN dbo.Player p ON p.ID = cr.Player WHERE cr.Club = @club;",
                "SELECT i.Id, i.ClubId, i.PlayerId, i.InvitedByPlayerId, i.Status, i.CreatedAtUtc, i.ExpiresAtUtc",
                "FROM dbo.ClubInvitation i WITH (UPDLOCK, HOLDLOCK) WHERE i.ClubId = @club AND i.Status = 'open';",
              ].join(" "),
            ),
          );
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
      return database.withPool(async (pool) => {
        const request = pool.request();
        request.multiple = true;
        request.input("player", mssql.Int, playerId);
        request.input("now", mssql.DateTime2(0), new Date(now));
        const [
          playerRows = [],
          clubRows = [],
          memberRows = [],
          clubInvitationRows = [],
          invitationRows = [],
          blockRows = [],
        ] = recordsets(await request.query(MY_CLUB_QUERY));
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
      });
    },

    async inviteCandidates(clubId, now) {
      return database.withPool(async (pool) => {
        const request = pool.request();
        request.multiple = true;
        request.input("club", mssql.Int, clubId);
        request.input("since", mssql.DateTime2(0), new Date(now - 14 * DAY_MS));
        const [playerRows = [], invitationRows = []] = recordsets(await request.query(CANDIDATES_QUERY));
        return {
          players: playerRows.map((row) => ({
            playerId: Number(row.ID),
            discordId: normalizeDiscordId(row.DiscordID) || normalizeText(row.DiscordID),
            name: normalizeText(row.Name),
            country: normalizeText(row.Country).toLowerCase(),
          })),
          invitations: invitationRows.map(toInvitation),
        };
      });
    },

    async newClubIds() {
      const rows = await database.withPool(async (pool) =>
        rowsOf(await pool.request().query("SELECT ID FROM dbo.Club WHERE EstablishedAtUtc IS NULL;")),
      );
      return rows.map((row) => Number(row.ID));
    },

    expireInvitations(now, decide) {
      return attempt(() =>
        database.withTransaction(async (tx) => {
          const request = tx.request();
          request.input("now", mssql.DateTime2(0), new Date(now));
          const invitations = rowsOf(await request.query(EXPIRED_INVITATIONS_QUERY)).map(toInvitation);
          if (!invitations.length) return 0;
          const clubIds = [...new Set(invitations.map((invitation) => invitation.clubId))];
          const clubRows = rowsOf(
            await tx.request().query(`SELECT ${CLUB_COLUMNS_SQL} FROM dbo.Club c WHERE c.ID IN (${idList(clubIds)});`),
          );
          const clubs = new Map(clubRows.map((row) => [Number(row.ID), toClubState(row, [])]));
          const steps = decide(invitations, (id) => clubs.get(id));
          await applyPlan(tx, steps, now);
          return invitations.length;
        }),
      );
    },

    async rosterPresence() {
      const rows = await database.withPool(async (pool) =>
        rowsOf(
          await pool
            .request()
            .query(`SELECT ${MEMBER_COLUMNS_SQL} FROM dbo.ClubRoster cr INNER JOIN dbo.Player p ON p.ID = cr.Player;`),
        ),
      );
      return rows.map((row) => ({ clubId: Number(row.Club), member: toMember(row) }));
    },

    async adminClubs() {
      const rows = await database.withPool(async (pool) => rowsOf(await pool.request().query(ADMIN_CLUBS_QUERY)));
      return rows.map((row) => ({
        clubId: Number(row.club_id),
        publicId: normalizeText(row.public_id),
        name: normalizeText(row.name),
        tag: normalizeText(row.tag),
        members: Number(row.members) || 0,
        hasLogo: Boolean(normalizeText(row.logo_hash) || normalizeText(row.logo)),
      }));
    },

    async raiseMatchActivity(since) {
      return database.withPool(async (pool) => {
        const request = pool.request();
        request.input("since", mssql.DateTime2(3), new Date(since));
        const [changed = 0] = affected(await request.query(MATCH_ACTIVITY_SQL));
        return changed;
      });
    },

    async cleanUp(now) {
      return database.withPool(async (pool) => {
        const request = pool.request();
        request.input("now", mssql.DateTime2(0), new Date(now));
        request.input("before", mssql.DateTime2(0), new Date(now - 30 * DAY_MS));
        return affected(await request.query(CLEANUP_SQL)).reduce((total, count) => total + count, 0);
      });
    },
  };
}
