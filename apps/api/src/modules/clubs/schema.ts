// The club management schema (docs/adr/0012), applied by npm run ops:club-schema: new columns of dbo.Club and
// dbo.ClubRoster, the new club tables, a club id for every existing club and the unique club name. Additive only:
// nothing existing changes, and every step checks what exists first, so the command can run again. One
// transaction, checked at the end; without --apply it is a dry run that does all of it and rolls back. The legacy
// procedures write both tables with column lists (read live 2026-11-19), so new nullable or defaulted columns
// break none of them; dbo.Club gets no trigger (the legacy CreateClub reads @@IDENTITY, robo's /club active uses
// a plain OUTPUT on it).
//
// Also the backup tables around the migration (--backup, --drop-backups) and E1's one-off deletion of clubs
// without members (npm run ops:club-cleanup): exactly the listed ids, each only while it still has no member.

import { randomInt } from "node:crypto";
import { CLUB_PUBLIC_ID_ALPHABET, CLUB_PUBLIC_ID_LENGTH } from "@ms/shared/clubs";
import type { Database, Queryable } from "../../db/database.ts";
import { mssql } from "../../db/database.ts";

type Row = Record<string, unknown>;

const present = (value: unknown): boolean => value !== null && value !== undefined;

function rowsOf(result: { recordset?: unknown }): Row[] {
  return Array.isArray(result.recordset) ? (result.recordset as Row[]) : [];
}

/** The rows each statement of a batch changed. */
function affected(result: { readonly rowsAffected?: readonly number[] }): number[] {
  return result.rowsAffected ? [...result.rowsAffected] : [];
}

const sum = (counts: readonly number[]): number => counts.reduce((total, count) => total + count, 0);

async function tableExists(db: Queryable, name: string): Promise<boolean> {
  const request = db.request();
  request.input("name", mssql.NVarChar(256), name);
  return present(rowsOf(await request.query("SELECT OBJECT_ID(@name, N'U') AS id;"))[0]?.id);
}

// ---------------------------------------------------------------------------------------------------
// Club ids

/** A new club id: eight random characters of the alphabet, drawn with node:crypto. */
export function generateClubPublicId(random: (max: number) => number = randomInt): string {
  let id = "";
  for (let index = 0; index < CLUB_PUBLIC_ID_LENGTH; index += 1) {
    id += CLUB_PUBLIC_ID_ALPHABET.charAt(random(CLUB_PUBLIC_ID_ALPHABET.length));
  }
  return id;
}

/**
 * The default of dbo.Club.PublicId: eight characters of the alphabet, each from its own NEWID(), so clubs the bot
 * still creates until go-live get an id too. The website generates its own ids (generateClubPublicId) and the
 * unique index makes a duplicate impossible.
 */
export function publicIdDefaultSql(): string {
  const size = CLUB_PUBLIC_ID_ALPHABET.length;
  const pick = `SUBSTRING('${CLUB_PUBLIC_ID_ALPHABET}', 1 + CONVERT(INT, CONVERT(BINARY(2), NEWID())) % ${size}, 1)`;
  return Array.from({ length: CLUB_PUBLIC_ID_LENGTH }, () => pick).join(" + ");
}

const PUBLIC_ID_TYPE = `CHAR(${CLUB_PUBLIC_ID_LENGTH}) COLLATE Latin1_General_100_BIN2`;

// ---------------------------------------------------------------------------------------------------
// Schema

export const CLUB_COLUMNS = [
  "PublicId",
  "EstablishedAtUtc",
  "StreakSinceUtc",
  "InactiveSinceUtc",
  "InactiveWarnedAtUtc",
  "DeletionWarnedAtUtc",
] as const;
export const ROSTER_COLUMNS = ["JoinedAtUtc", "AbsentSinceUtc", "AbsenceExempt"] as const;
export const CLUB_TABLES = [
  "ClubSystemState",
  "ClubInvitation",
  "ClubPlayerState",
  "ClubJoinBlock",
  "ClubEvent",
  "ClubLogo",
] as const;
export const CLUB_INDEXES = ["UX_Club_PublicId", "UX_Club_ClubName"] as const;

/**
 * dbo.Club: the club id (filled below), when the club was established (existing clubs at once, through WITH
 * VALUES; the default also marks clubs the bot creates until go-live; the website inserts NULL for a new club, so
 * L1's counter runs), the two-member streak, the new-club inactive mark and the warnings sent for it.
 */
export const CLUB_COLUMNS_SQL = [
  "IF COL_LENGTH(N'dbo.Club', N'PublicId') IS NULL",
  `  ALTER TABLE dbo.Club ADD PublicId ${PUBLIC_ID_TYPE} NULL;`,
  "IF COL_LENGTH(N'dbo.Club', N'EstablishedAtUtc') IS NULL",
  "  ALTER TABLE dbo.Club ADD EstablishedAtUtc DATETIME2(0) NULL",
  "    CONSTRAINT DF_Club_EstablishedAtUtc DEFAULT (SYSUTCDATETIME()) WITH VALUES;",
  "IF COL_LENGTH(N'dbo.Club', N'StreakSinceUtc') IS NULL ALTER TABLE dbo.Club ADD StreakSinceUtc DATETIME2(0) NULL;",
  "IF COL_LENGTH(N'dbo.Club', N'InactiveSinceUtc') IS NULL ALTER TABLE dbo.Club ADD InactiveSinceUtc DATETIME2(0) NULL;",
  "IF COL_LENGTH(N'dbo.Club', N'InactiveWarnedAtUtc') IS NULL",
  "  ALTER TABLE dbo.Club ADD InactiveWarnedAtUtc DATETIME2(0) NULL;",
  "IF COL_LENGTH(N'dbo.Club', N'DeletionWarnedAtUtc') IS NULL",
  "  ALTER TABLE dbo.Club ADD DeletionWarnedAtUtc DATETIME2(0) NULL;",
].join(" ");

/**
 * dbo.ClubRoster: when the member joined (NULL for the rows of before; every new row gets the time, also the
 * bot's), the absence stamp of J5 and its go-live exemption. The table's activity trigger stamps only a new row
 * or a changed club, so writing these columns is no player activity.
 */
export const ROSTER_COLUMNS_SQL = [
  "IF COL_LENGTH(N'dbo.ClubRoster', N'JoinedAtUtc') IS NULL",
  "  ALTER TABLE dbo.ClubRoster ADD JoinedAtUtc DATETIME2(0) NULL",
  "    CONSTRAINT DF_ClubRoster_JoinedAtUtc DEFAULT (SYSUTCDATETIME());",
  "IF COL_LENGTH(N'dbo.ClubRoster', N'AbsentSinceUtc') IS NULL",
  "  ALTER TABLE dbo.ClubRoster ADD AbsentSinceUtc DATETIME2(0) NULL;",
  "IF COL_LENGTH(N'dbo.ClubRoster', N'AbsenceExempt') IS NULL",
  "  ALTER TABLE dbo.ClubRoster ADD AbsenceExempt BIT NOT NULL CONSTRAINT DF_ClubRoster_AbsenceExempt DEFAULT (0);",
].join(" ");

/**
 * The new tables. No foreign keys to the legacy tables (they have none, and a club the bot deletes until go-live
 * must not fail on them); the lifecycle job removes rows of clubs that no longer exist.
 */
export const CLUB_TABLES_SQL = [
  // The feature's mode, read by the website and the bot (docs/adr/0012), and the go-live time.
  "IF OBJECT_ID(N'dbo.ClubSystemState', N'U') IS NULL",
  "BEGIN",
  "CREATE TABLE dbo.ClubSystemState (",
  "  Id TINYINT NOT NULL CONSTRAINT PK_ClubSystemState PRIMARY KEY CONSTRAINT CK_ClubSystemState_Id CHECK (Id = 1),",
  "  Mode VARCHAR(8) NOT NULL CONSTRAINT DF_ClubSystemState_Mode DEFAULT ('off')",
  "    CONSTRAINT CK_ClubSystemState_Mode CHECK (Mode IN ('off', 'admins', 'on')),",
  "  GoLiveAtUtc DATETIME2(0) NULL,",
  "  UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_ClubSystemState_UpdatedAtUtc DEFAULT (SYSUTCDATETIME())",
  ");",
  "INSERT INTO dbo.ClubSystemState (Id, Mode) VALUES (1, 'off');",
  "END",
  // J2: invitations stay after they are answered, for the 14-day rule; one open invitation per club and player.
  "IF OBJECT_ID(N'dbo.ClubInvitation', N'U') IS NULL",
  "BEGIN",
  "CREATE TABLE dbo.ClubInvitation (",
  "  Id INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_ClubInvitation PRIMARY KEY,",
  "  ClubId INT NOT NULL,",
  "  PlayerId INT NOT NULL,",
  "  InvitedByPlayerId INT NOT NULL,",
  "  Status VARCHAR(10) NOT NULL CONSTRAINT DF_ClubInvitation_Status DEFAULT ('open')",
  "    CONSTRAINT CK_ClubInvitation_Status",
  "    CHECK (Status IN ('open', 'accepted', 'declined', 'revoked', 'expired', 'closed')),",
  "  CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_ClubInvitation_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),",
  "  ExpiresAtUtc DATETIME2(0) NOT NULL,",
  "  ClosedAtUtc DATETIME2(0) NULL,",
  "  DmChannelId VARCHAR(20) NULL,",
  "  DmMessageId VARCHAR(20) NULL,",
  "  CONSTRAINT CK_ClubInvitation_Closed",
  "    CHECK ((Status = 'open' AND ClosedAtUtc IS NULL) OR (Status <> 'open' AND ClosedAtUtc IS NOT NULL))",
  ");",
  "CREATE UNIQUE INDEX UX_ClubInvitation_Open ON dbo.ClubInvitation (ClubId, PlayerId) WHERE Status = 'open';",
  "CREATE INDEX IX_ClubInvitation_Player ON dbo.ClubInvitation (PlayerId, Status);",
  "CREATE INDEX IX_ClubInvitation_Club ON dbo.ClubInvitation (ClubId, PlayerId, CreatedAtUtc);",
  "END",
  // C1 and J3 survive the club: the player's last club creation and last exit.
  "IF OBJECT_ID(N'dbo.ClubPlayerState', N'U') IS NULL",
  "CREATE TABLE dbo.ClubPlayerState (",
  "  PlayerId INT NOT NULL CONSTRAINT PK_ClubPlayerState PRIMARY KEY,",
  "  LastClubCreatedAtUtc DATETIME2(0) NULL,",
  "  LastClubExitAtUtc DATETIME2(0) NULL",
  ");",
  // J4: a removed member cannot rejoin that club before the block ends.
  "IF OBJECT_ID(N'dbo.ClubJoinBlock', N'U') IS NULL",
  "CREATE TABLE dbo.ClubJoinBlock (",
  "  ClubId INT NOT NULL,",
  "  PlayerId INT NOT NULL,",
  "  BlockedUntilUtc DATETIME2(0) NOT NULL,",
  "  CONSTRAINT PK_ClubJoinBlock PRIMARY KEY (ClubId, PlayerId)",
  ");",
  // The outbox (4.2): written by the website in the transaction of the change, worked off by the bot.
  "IF OBJECT_ID(N'dbo.ClubEvent', N'U') IS NULL",
  "BEGIN",
  "CREATE TABLE dbo.ClubEvent (",
  "  Id BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_ClubEvent PRIMARY KEY,",
  "  Type VARCHAR(40) NOT NULL,",
  "  ClubId INT NULL,",
  `  ClubPublicId ${PUBLIC_ID_TYPE} NULL,`,
  "  ClubName NVARCHAR(50) NULL,",
  "  ClubTag NVARCHAR(5) NULL,",
  "  ActorPlayerId INT NULL,",
  "  TargetPlayerId INT NULL,",
  "  Payload NVARCHAR(MAX) NOT NULL CONSTRAINT CK_ClubEvent_Payload CHECK (ISJSON(Payload) = 1),",
  "  CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_ClubEvent_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),",
  "  Attempts INT NOT NULL CONSTRAINT DF_ClubEvent_Attempts DEFAULT (0),",
  "  ClaimedUntilUtc DATETIME2(3) NULL,",
  "  DoneEffects NVARCHAR(MAX) NULL",
  "    CONSTRAINT CK_ClubEvent_DoneEffects CHECK (DoneEffects IS NULL OR ISJSON(DoneEffects) = 1),",
  "  ProcessedAtUtc DATETIME2(3) NULL,",
  "  LastError NVARCHAR(1000) NULL",
  ");",
  "CREATE INDEX IX_ClubEvent_Pending ON dbo.ClubEvent (Id) WHERE ProcessedAtUtc IS NULL;",
  "CREATE INDEX IX_ClubEvent_CreatedAtUtc ON dbo.ClubEvent (CreatedAtUtc);",
  "END",
  // F6: the uploaded logo after processing, served by the logo route with its hash in the URL.
  "IF OBJECT_ID(N'dbo.ClubLogo', N'U') IS NULL",
  "CREATE TABLE dbo.ClubLogo (",
  "  ClubId INT NOT NULL CONSTRAINT PK_ClubLogo PRIMARY KEY,",
  "  ContentType VARCHAR(20) NOT NULL",
  "    CONSTRAINT CK_ClubLogo_ContentType CHECK (ContentType IN ('image/webp', 'image/png', 'image/jpeg')),",
  "  Hash CHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL,",
  "  Width INT NOT NULL,",
  "  Height INT NOT NULL,",
  "  Data VARBINARY(MAX) NOT NULL CONSTRAINT CK_ClubLogo_Data CHECK (DATALENGTH(Data) > 0),",
  "  UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_ClubLogo_UpdatedAtUtc DEFAULT (SYSUTCDATETIME())",
  ");",
].join(" ");

/** After the backfill: every club has an id, new clubs get one by default, and no id exists twice. */
export const PUBLIC_ID_FINISH_SQL = [
  "IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.Club') AND name = N'PublicId' AND is_nullable = 1)",
  `  ALTER TABLE dbo.Club ALTER COLUMN PublicId ${PUBLIC_ID_TYPE} NOT NULL;`,
  "IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'DF_Club_PublicId'",
  "  AND parent_object_id = OBJECT_ID(N'dbo.Club'))",
  `  ALTER TABLE dbo.Club ADD CONSTRAINT DF_Club_PublicId DEFAULT (${publicIdDefaultSql()}) FOR PublicId;`,
  "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Club_PublicId' AND object_id = OBJECT_ID(N'dbo.Club'))",
  "  CREATE UNIQUE INDEX UX_Club_PublicId ON dbo.Club (PublicId);",
].join(" ");

/** F3: names are unique (the tag already is, index IX_Club). Created only when no name exists twice. */
export const DUPLICATE_NAMES_QUERY =
  "SELECT ClubName AS name, COUNT(*) AS clubs FROM dbo.Club GROUP BY ClubName HAVING COUNT(*) > 1;";
export const NAME_INDEX_SQL = [
  "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Club_ClubName' AND object_id = OBJECT_ID(N'dbo.Club'))",
  "  CREATE UNIQUE INDEX UX_Club_ClubName ON dbo.Club (ClubName);",
].join(" ");

/** Writes in one transaction must not wait long behind a running query (the ALTERs hold schema locks). */
export const SESSION_SQL = "SET XACT_ABORT ON; SET LOCK_TIMEOUT 10000;";

const quotedList = (names: readonly string[]): string => names.map((name) => `N'${name}'`).join(", ");

/** What exists of the schema, and fingerprints of every existing value (they must not change). */
export const SCHEMA_STATE_QUERY = [
  "SELECT t.name + N'.' + c.name AS name FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id",
  "WHERE t.schema_id = SCHEMA_ID(N'dbo') AND (",
  `  (t.name = N'Club' AND c.name IN (${quotedList(CLUB_COLUMNS)}))`,
  `  OR (t.name = N'ClubRoster' AND c.name IN (${quotedList(ROSTER_COLUMNS)})));`,
  `SELECT name FROM sys.tables WHERE schema_id = SCHEMA_ID(N'dbo') AND name IN (${quotedList(CLUB_TABLES)});`,
  `SELECT name FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.Club') AND name IN (${quotedList(CLUB_INDEXES)});`,
  "SELECT (SELECT COUNT(*) FROM dbo.Club) AS clubs, (SELECT COUNT(*) FROM dbo.ClubRoster) AS roster_rows,",
  "  (SELECT CHECKSUM_AGG(CHECKSUM(ID, ClubName, ClanTag, Owner, IsOpen, Region, Region2, Region3, ClubCode,",
  "     ClubCode2, ClubCode3, Logo, Color1, Color2, Stadium, DiscordServer, Activity, CreatedAtUtc)) FROM dbo.Club)",
  "     AS club_fingerprint,",
  "  (SELECT CHECKSUM_AGG(CHECKSUM(Player, Club, Rank, IsOfficer)) FROM dbo.ClubRoster) AS roster_fingerprint;",
].join(" ");

/** The new values after the change (the columns exist by then). */
export const NEW_VALUES_QUERY = [
  "SELECT",
  "  (SELECT COUNT(*) FROM dbo.Club WHERE PublicId IS NULL) AS without_public_id,",
  `  (SELECT COUNT(*) FROM dbo.Club WHERE PublicId COLLATE Latin1_General_100_BIN2 LIKE N'%[^${CLUB_PUBLIC_ID_ALPHABET}]%')`,
  "    AS invalid_public_ids,",
  "  (SELECT COUNT(DISTINCT PublicId) FROM dbo.Club) AS distinct_public_ids,",
  "  (SELECT COUNT(*) FROM dbo.Club WHERE EstablishedAtUtc IS NULL) AS not_established,",
  "  (SELECT COUNT(*) FROM dbo.ClubRoster WHERE JoinedAtUtc IS NOT NULL OR AbsentSinceUtc IS NOT NULL",
  "     OR AbsenceExempt <> 0) AS roster_rows_with_new_values,",
  "  (SELECT COUNT(*) FROM dbo.ClubSystemState) AS state_rows,",
  "  (SELECT TOP 1 Mode FROM dbo.ClubSystemState ORDER BY Id) AS mode;",
].join(" ");

export const CLUBS_WITHOUT_PUBLIC_ID_QUERY = "SELECT ID FROM dbo.Club WITH (UPDLOCK, HOLDLOCK) WHERE PublicId IS NULL;";
export const PUBLIC_IDS_QUERY = "SELECT PublicId FROM dbo.Club WHERE PublicId IS NOT NULL;";

interface SchemaState {
  readonly columns: ReadonlySet<string>;
  readonly tables: ReadonlySet<string>;
  readonly indexes: ReadonlySet<string>;
  readonly clubs: number;
  readonly rosterRows: number;
  readonly clubFingerprint: unknown;
  readonly rosterFingerprint: unknown;
}

async function readState(db: Queryable): Promise<SchemaState> {
  const request = db.request();
  request.multiple = true;
  const result: { recordsets?: unknown } = await request.query(SCHEMA_STATE_QUERY);
  const sets = Array.isArray(result.recordsets) ? (result.recordsets as Row[][]) : [];
  const names = (index: number): Set<string> => new Set((sets[index] ?? []).map((row) => String(row.name)));
  const counts = sets[3]?.[0] ?? {};
  return {
    columns: names(0),
    tables: names(1),
    indexes: names(2),
    clubs: Number(counts.clubs),
    rosterRows: Number(counts.roster_rows),
    clubFingerprint: counts.club_fingerprint ?? null,
    rosterFingerprint: counts.roster_fingerprint ?? null,
  };
}

export interface ClubSchemaReport {
  readonly applied: boolean;
  readonly status: string;
  readonly addedColumns: readonly string[];
  readonly createdTables: readonly string[];
  readonly createdIndexes: readonly string[];
  readonly publicIdsAssigned: number;
  /** Names that exist twice and keep UX_Club_ClubName from being created (shown to the owner). */
  readonly duplicateNames: readonly string[];
  readonly clubs: number;
  readonly rosterRows: number;
}

class DryRun<T> extends Error {
  readonly report: T;
  constructor(report: T) {
    super("dry run");
    this.report = report;
  }
}

async function runOrRollBack<T>(
  database: Pick<Database, "withTransaction">,
  work: (transaction: Queryable) => Promise<{ report: T; commit: boolean }>,
): Promise<T> {
  try {
    return await database.withTransaction(async (transaction) => {
      const { report, commit } = await work(transaction);
      if (!commit) throw new DryRun(report);
      return report;
    });
  } catch (error) {
    if (error instanceof DryRun) return (error as DryRun<T>).report;
    throw error;
  }
}

/** Gives every club without an id a new one, none equal to another; returns how many were given. */
async function assignPublicIds(db: Queryable, generate: () => string): Promise<number> {
  const clubs = rowsOf(await db.request().query(CLUBS_WITHOUT_PUBLIC_ID_QUERY)).map((row) => Number(row.ID));
  if (!clubs.length) return 0;
  const taken = new Set(rowsOf(await db.request().query(PUBLIC_IDS_QUERY)).map((row) => String(row.PublicId)));
  const assigned = clubs.map((clubId) => {
    let id = generate();
    while (taken.has(id)) id = generate();
    taken.add(id);
    return { clubId, id };
  });
  // 400 clubs (800 parameters) per statement, far below SQL Server's 2,100.
  for (let start = 0; start < assigned.length; start += 400) {
    const chunk = assigned.slice(start, start + 400);
    const request = db.request();
    const values = chunk.map((entry, index) => {
      request.input(`club${index}`, mssql.Int, entry.clubId);
      request.input(`id${index}`, mssql.Char(CLUB_PUBLIC_ID_LENGTH), entry.id);
      return `(@club${index}, @id${index})`;
    });
    const result = await request.query(
      "UPDATE c SET PublicId = v.PublicId FROM dbo.Club c " +
        `JOIN (VALUES ${values.join(", ")}) v (ID, PublicId) ON v.ID = c.ID WHERE c.PublicId IS NULL;`,
    );
    const updated = sum(affected(result));
    if (updated !== chunk.length)
      throw new Error(`Club ids: ${updated} of ${chunk.length} clubs updated; rolled back.`);
  }
  return assigned.length;
}

export interface ClubSchemaOptions {
  readonly apply: boolean;
  /** The backup tables of this UTC day (yyyymmdd) must exist before --apply changes anything. */
  readonly stamp: string;
  readonly generate?: () => string;
}

/** The schema step of ops:club-schema: a dry run without apply, committed with it (after the backup). */
export async function applyClubSchema(
  database: Pick<Database, "withTransaction">,
  options: ClubSchemaOptions,
): Promise<ClubSchemaReport> {
  const generate = options.generate ?? (() => generateClubPublicId());
  return runOrRollBack(database, async (db) => {
    await db.request().query(SESSION_SQL);
    const before = await readState(db);
    const missing = (all: readonly string[], have: ReadonlySet<string>, prefix = ""): string[] =>
      all.filter((name) => !have.has(prefix + name)).map((name) => prefix + name);
    const missingColumns = [
      ...missing(CLUB_COLUMNS, before.columns, "Club."),
      ...missing(ROSTER_COLUMNS, before.columns, "ClubRoster."),
    ];
    const missingTables = missing(CLUB_TABLES, before.tables);
    const missingIndexes = missing(CLUB_INDEXES, before.indexes);
    const base = { clubs: before.clubs, rosterRows: before.rosterRows };
    if (!missingColumns.length && !missingTables.length && !missingIndexes.length) {
      return {
        commit: true,
        report: {
          ...base,
          applied: false,
          status: "nothing to change",
          addedColumns: [],
          createdTables: [],
          createdIndexes: [],
          publicIdsAssigned: 0,
          duplicateNames: [],
        },
      };
    }
    if (options.apply && !(await backupsExist(db, options.stamp))) {
      throw new Error(`Back up first: npm run ops:club-schema -- --backup (no backup tables of ${options.stamp}).`);
    }

    await db.request().query(CLUB_COLUMNS_SQL);
    await db.request().query(ROSTER_COLUMNS_SQL);
    await db.request().query(CLUB_TABLES_SQL);
    const publicIdsAssigned = await assignPublicIds(db, generate);
    await db.request().query(PUBLIC_ID_FINISH_SQL);
    const duplicateNames = rowsOf(await db.request().query(DUPLICATE_NAMES_QUERY)).map((row) => String(row.name));
    if (!duplicateNames.length) await db.request().query(NAME_INDEX_SQL);

    const after = await readState(db);
    const values = rowsOf(await db.request().query(NEW_VALUES_QUERY))[0] ?? {};
    const problems: string[] = [];
    if (after.clubs !== before.clubs || after.rosterRows !== before.rosterRows) problems.push("row counts changed");
    if (after.clubFingerprint !== before.clubFingerprint) problems.push("existing club values changed");
    if (after.rosterFingerprint !== before.rosterFingerprint) problems.push("existing roster values changed");
    if (
      missing(CLUB_COLUMNS, after.columns, "Club.").length ||
      missing(ROSTER_COLUMNS, after.columns, "ClubRoster.").length
    ) {
      problems.push("columns missing");
    }
    if (missing(CLUB_TABLES, after.tables).length) problems.push("tables missing");
    if (!after.indexes.has("UX_Club_PublicId")) problems.push("UX_Club_PublicId missing");
    if (!duplicateNames.length && !after.indexes.has("UX_Club_ClubName")) problems.push("UX_Club_ClubName missing");
    if (Number(values.without_public_id) !== 0 || Number(values.invalid_public_ids) !== 0) {
      problems.push("clubs without a valid id");
    }
    if (Number(values.distinct_public_ids) !== after.clubs) problems.push("a club id exists twice");
    if (Number(values.not_established) !== 0) problems.push("existing clubs not established");
    if (missingColumns.includes("ClubRoster.JoinedAtUtc") && Number(values.roster_rows_with_new_values) !== 0) {
      problems.push("old roster rows got new values");
    }
    if (Number(values.state_rows) !== 1 || (missingTables.includes("ClubSystemState") && values.mode !== "off")) {
      problems.push("mode row");
    }
    if (problems.length) throw new Error(`Club schema check failed (${problems.join(", ")}); rolled back.`);

    const report: ClubSchemaReport = {
      ...base,
      applied: options.apply,
      status: options.apply ? "applied" : "dry run, rolled back",
      addedColumns: missingColumns,
      createdTables: missingTables,
      createdIndexes: missing(CLUB_INDEXES, before.indexes).filter((name) => after.indexes.has(name)),
      publicIdsAssigned,
      duplicateNames,
    };
    return { commit: options.apply, report };
  });
}

// ---------------------------------------------------------------------------------------------------
// Backup tables (--backup before --apply, --drop-backups after the live check)

export const BACKED_UP_TABLES = ["Club", "ClubRoster", "_PlayerLobby"] as const;

/** "yyyymmdd" of a UTC day. */
export function utcStamp(at: Date): string {
  return at.toISOString().slice(0, 10).replace(/-/g, "");
}

function assertStamp(stamp: string): void {
  if (!/^\d{8}$/.test(stamp)) throw new Error(`Invalid backup stamp "${stamp}" (yyyymmdd).`);
}

export function backupTableName(table: (typeof BACKED_UP_TABLES)[number], stamp: string): string {
  assertStamp(stamp);
  return `${table}_Backup_${stamp}`;
}

async function backupsExist(db: Queryable, stamp: string): Promise<boolean> {
  for (const table of BACKED_UP_TABLES) {
    if (!(await tableExists(db, `dbo.${backupTableName(table, stamp)}`))) return false;
  }
  return true;
}

export interface BackupReport {
  readonly created: readonly { readonly table: string; readonly rows: number }[];
}

/** Copies dbo.Club, dbo.ClubRoster and dbo._PlayerLobby to *_Backup_<stamp>; refuses when one exists already. */
export async function backupClubTables(
  database: Pick<Database, "withTransaction">,
  stamp: string,
): Promise<BackupReport> {
  return database.withTransaction(async (db) => {
    await db.request().query(SESSION_SQL);
    const created: { table: string; rows: number }[] = [];
    for (const table of BACKED_UP_TABLES) {
      const backup = backupTableName(table, stamp);
      if (await tableExists(db, `dbo.${backup}`)) throw new Error(`dbo.${backup} exists already; nothing was copied.`);
      await db.request().query(`SELECT * INTO dbo.${backup} FROM dbo.${table};`);
      const counts = rowsOf(
        await db
          .request()
          .query(
            `SELECT (SELECT COUNT(*) FROM dbo.${table}) AS source_rows, (SELECT COUNT(*) FROM dbo.${backup}) AS backup_rows;`,
          ),
      )[0];
      if (Number(counts?.source_rows) !== Number(counts?.backup_rows)) {
        throw new Error(`dbo.${backup} does not hold every row of dbo.${table}; rolled back.`);
      }
      created.push({ table: `dbo.${backup}`, rows: Number(counts?.backup_rows) });
    }
    return { created };
  });
}

/** Drops the backup tables of a stamp (after the live check); missing ones are skipped. */
export async function dropClubBackups(
  database: Pick<Database, "withTransaction">,
  stamp: string,
): Promise<{ readonly dropped: readonly string[] }> {
  return database.withTransaction(async (db) => {
    const dropped: string[] = [];
    for (const table of BACKED_UP_TABLES) {
      const backup = `dbo.${backupTableName(table, stamp)}`;
      if (!(await tableExists(db, backup))) continue;
      await db.request().query(`DROP TABLE ${backup};`);
      dropped.push(backup);
    }
    return { dropped };
  });
}

// ---------------------------------------------------------------------------------------------------
// E1: clubs without members, deleted completely

/** The rows attached to a club, deleted with it (C2); the club row itself goes last. */
export const CLUB_ATTACHMENT_DELETES: readonly { readonly table: string; readonly column: string }[] = [
  { table: "_PlayerLobby", column: "Club" },
  { table: "ClubInvitation", column: "ClubId" },
  { table: "ClubJoinBlock", column: "ClubId" },
  { table: "ClubLogo", column: "ClubId" },
];

export interface CleanupClub {
  readonly clubId: number;
  readonly publicId: string;
  readonly tag: string;
  readonly name: string;
  readonly ownerDiscordId: string;
}

export interface CleanupReport {
  readonly applied: boolean;
  readonly status: string;
  readonly deleted: readonly CleanupClub[];
  readonly attachedRowsDeleted: number;
}

export const CLEANUP_LOG_COMMAND = "WebsiteClubDelete";

/**
 * Deletes exactly the listed clubs, each with what is attached to it and one dbo.CommandLog row; refuses the whole
 * list when a club is missing, has a member, or is not in the backup of the stamp. A dry run without apply.
 */
export async function deleteEmptyClubs(
  database: Pick<Database, "withTransaction">,
  options: { readonly ids: readonly number[]; readonly apply: boolean; readonly stamp: string },
): Promise<CleanupReport> {
  const ids = [...new Set(options.ids)];
  if (!ids.length || ids.some((id) => !Number.isInteger(id) || id <= 0))
    throw new Error("List the club ids: --ids=3,342");
  const backup = `dbo.${backupTableName("Club", options.stamp)}`;
  return runOrRollBack(database, async (db) => {
    await db.request().query(SESSION_SQL);
    if (!(await tableExists(db, backup)))
      throw new Error(`No backup table ${backup}: back up first; nothing was deleted.`);
    const lookup = db.request();
    const params = ids.map((id, index) => {
      lookup.input(`club${index}`, mssql.Int, id);
      return `@club${index}`;
    });
    const list = params.join(", ");
    const rows = rowsOf(
      await lookup.query(
        [
          "SELECT c.ID, c.PublicId, c.ClanTag, c.ClubName, c.Owner,",
          "  (SELECT COUNT(*) FROM dbo.ClubRoster cr WITH (UPDLOCK, HOLDLOCK) WHERE cr.Club = c.ID) AS members,",
          `  CASE WHEN EXISTS (SELECT 1 FROM ${backup} b WHERE b.ID = c.ID) THEN 1 ELSE 0 END AS backed_up`,
          `FROM dbo.Club c WITH (UPDLOCK, HOLDLOCK) WHERE c.ID IN (${list});`,
        ].join(" "),
      ),
    );
    const found = new Map(rows.map((row) => [Number(row.ID), row]));
    const problems = ids.flatMap((id) => {
      const row = found.get(id);
      if (!row) return [`club ${id} does not exist`];
      if (Number(row.members) !== 0) return [`club ${id} has ${Number(row.members)} member(s)`];
      if (Number(row.backed_up) !== 1) return [`club ${id} is not in ${backup}`];
      return [];
    });
    if (problems.length) throw new Error(`Nothing was deleted: ${problems.join("; ")}.`);

    const clubs: CleanupClub[] = ids.map((id) => {
      const row = found.get(id) ?? {};
      return {
        clubId: id,
        publicId: typeof row.PublicId === "string" ? row.PublicId : "",
        tag: typeof row.ClanTag === "string" ? row.ClanTag.trim() : "",
        name: typeof row.ClubName === "string" ? row.ClubName.trim() : "",
        ownerDiscordId: typeof row.Owner === "string" ? row.Owner.trim() : "",
      };
    });
    let attachedRowsDeleted = 0;
    for (const { table, column } of CLUB_ATTACHMENT_DELETES) {
      const request = db.request();
      ids.forEach((id, index) => request.input(`club${index}`, mssql.Int, id));
      const result = await request.query(
        `IF OBJECT_ID(N'dbo.${table}', N'U') IS NOT NULL DELETE FROM dbo.${table} WHERE ${column} IN (${list});`,
      );
      attachedRowsDeleted += sum(affected(result));
    }
    const remove = db.request();
    ids.forEach((id, index) => remove.input(`club${index}`, mssql.Int, id));
    const logs = clubs.map((club, index) => {
      remove.input(
        `log${index}`,
        mssql.NVarChar(4000),
        JSON.stringify({
          club_id: club.clubId,
          public_id: club.publicId,
          tag: club.tag,
          name: club.name,
          owner_discord_id: club.ownerDiscordId,
          reason: "E1: no members",
          source: "ops:club-cleanup",
        }),
      );
      return `(N'${CLEANUP_LOG_COMMAND}', @log${index})`;
    });
    const deleted = await remove.query(
      `DELETE FROM dbo.Club WHERE ID IN (${list}); INSERT INTO dbo.CommandLog (Command, Parameters) VALUES ${logs.join(", ")};`,
    );
    const [clubRows, logRows] = affected(deleted);
    if (clubRows !== ids.length || logRows !== ids.length) {
      throw new Error(
        `Expected ${ids.length} clubs and log rows, got ${clubRows ?? 0} and ${logRows ?? 0}; rolled back.`,
      );
    }
    return {
      commit: options.apply,
      report: {
        applied: options.apply,
        status: options.apply
          ? `deleted ${ids.length} club(s)`
          : `dry run, rolled back: would delete ${ids.length} club(s)`,
        deleted: clubs,
        attachedRowsDeleted,
      },
    };
  });
}
