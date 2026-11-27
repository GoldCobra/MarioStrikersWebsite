// The Recharged API's table (docs/adr/0016), created by npm run ops:recharged-schema: rocci121_toby.ExternalMatchReport,
// the match reports of the Recharged WFC server. Additive only: one new table, nothing existing changes. One
// transaction, checked before it ends: the new objects must be exactly the expected ones (the table with its key,
// unique constraint, checks and default), no other object may disappear, and the table must have the expected columns
// and no row. Without --apply it is a dry run that does all of it and rolls back. When the table exists in full it
// changes nothing; when it exists otherwise it refuses.
//
// The checks pin what the API and later futbot rely on: MSC 1v1 only (GameId 1), never a draw, two different Discord
// ids of 15 to 20 digits (in dbo.Player.DiscordID's collation, so the two compare without a collation conflict), match
// ids of the API's characters compared exactly (binary collation), and a report is "test" exactly when a test key sent
// it, so a test report can never be rated.

import type { Database, Queries, Row } from "../../db/database.ts";
import { sql } from "../../db/sql.ts";

export const REPORT_TABLE = "rocci121_toby.ExternalMatchReport";

export const CREATE_REPORT_TABLE_SQL = `CREATE TABLE rocci121_toby.ExternalMatchReport (
  Id INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_ExternalMatchReport PRIMARY KEY,
  Source VARCHAR(16) NOT NULL CONSTRAINT CK_ExternalMatchReport_Source CHECK (Source IN ('recharged')),
  Environment VARCHAR(4) NOT NULL
    CONSTRAINT CK_ExternalMatchReport_Environment CHECK (Environment IN ('test', 'live')),
  ExternalMatchId VARCHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT CK_ExternalMatchReport_ExternalMatchId CHECK (
      ExternalMatchId LIKE '[A-Za-z0-9]%' AND ExternalMatchId NOT LIKE '%[^A-Za-z0-9._:-]%'),
  GameId TINYINT NOT NULL CONSTRAINT CK_ExternalMatchReport_GameId CHECK (GameId = 1),
  ModeCode VARCHAR(10) NOT NULL CONSTRAINT CK_ExternalMatchReport_ModeCode CHECK (ModeCode = '1v1'),
  Player1DiscordId NVARCHAR(25) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
  Player1Score TINYINT NOT NULL CONSTRAINT CK_ExternalMatchReport_Player1Score CHECK (Player1Score <= 99),
  Player2DiscordId NVARCHAR(25) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
  Player2Score TINYINT NOT NULL CONSTRAINT CK_ExternalMatchReport_Player2Score CHECK (Player2Score <= 99),
  PlayedAtUtc DATETIME2(0) NOT NULL,
  ReceivedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_ExternalMatchReport_ReceivedAtUtc DEFAULT (SYSUTCDATETIME()),
  Status VARCHAR(10) NOT NULL
    CONSTRAINT CK_ExternalMatchReport_Status CHECK (Status IN ('pending', 'test', 'rated', 'rejected')),
  ProcessedAtUtc DATETIME2(3) NULL,
  RatedMatchId INT NULL,
  RejectReason NVARCHAR(200) NULL,
  CONSTRAINT UQ_ExternalMatchReport_Match UNIQUE (Source, Environment, ExternalMatchId),
  CONSTRAINT CK_ExternalMatchReport_Players CHECK (
    Player1DiscordId <> Player2DiscordId
    AND LEN(Player1DiscordId) BETWEEN 15 AND 20 AND Player1DiscordId NOT LIKE '%[^0-9]%'
    AND LEN(Player2DiscordId) BETWEEN 15 AND 20 AND Player2DiscordId NOT LIKE '%[^0-9]%'),
  CONSTRAINT CK_ExternalMatchReport_NoDraw CHECK (Player1Score <> Player2Score),
  CONSTRAINT CK_ExternalMatchReport_TestStatus CHECK (
    (Environment = 'test' AND Status = 'test') OR (Environment = 'live' AND Status <> 'test'))
);`;

/** Every object the table brings, as sys.objects names it (schema.name). */
export const EXPECTED_OBJECTS: readonly string[] = [
  REPORT_TABLE,
  "rocci121_toby.PK_ExternalMatchReport",
  "rocci121_toby.UQ_ExternalMatchReport_Match",
  "rocci121_toby.DF_ExternalMatchReport_ReceivedAtUtc",
  "rocci121_toby.CK_ExternalMatchReport_Source",
  "rocci121_toby.CK_ExternalMatchReport_Environment",
  "rocci121_toby.CK_ExternalMatchReport_ExternalMatchId",
  "rocci121_toby.CK_ExternalMatchReport_GameId",
  "rocci121_toby.CK_ExternalMatchReport_ModeCode",
  "rocci121_toby.CK_ExternalMatchReport_Player1Score",
  "rocci121_toby.CK_ExternalMatchReport_Player2Score",
  "rocci121_toby.CK_ExternalMatchReport_Status",
  "rocci121_toby.CK_ExternalMatchReport_Players",
  "rocci121_toby.CK_ExternalMatchReport_NoDraw",
  "rocci121_toby.CK_ExternalMatchReport_TestStatus",
];

/** The table's columns in order, as COLUMNS_QUERY describes them. */
export const EXPECTED_COLUMNS: readonly string[] = [
  "Id int NOT NULL IDENTITY",
  "Source varchar(16) NOT NULL COLLATE Latin1_General_100_CI_AS",
  "Environment varchar(4) NOT NULL COLLATE Latin1_General_100_CI_AS",
  "ExternalMatchId varchar(64) NOT NULL COLLATE Latin1_General_100_BIN2",
  "GameId tinyint NOT NULL",
  "ModeCode varchar(10) NOT NULL COLLATE Latin1_General_100_CI_AS",
  "Player1DiscordId nvarchar(25) NOT NULL COLLATE SQL_Latin1_General_CP1_CI_AS",
  "Player1Score tinyint NOT NULL",
  "Player2DiscordId nvarchar(25) NOT NULL COLLATE SQL_Latin1_General_CP1_CI_AS",
  "Player2Score tinyint NOT NULL",
  "PlayedAtUtc datetime2(0) NOT NULL",
  "ReceivedAtUtc datetime2(3) NOT NULL",
  "Status varchar(10) NOT NULL COLLATE Latin1_General_100_CI_AS",
  "ProcessedAtUtc datetime2(3) NULL",
  "RatedMatchId int NULL",
  "RejectReason nvarchar(200) NULL COLLATE Latin1_General_100_CI_AS",
];

const OBJECTS_QUERY = sql`
  SELECT SCHEMA_NAME(o.schema_id) + N'.' + o.name AS name FROM sys.objects o WHERE o.is_ms_shipped = 0;
`;

const COLUMNS_QUERY = sql`
  SELECT c.name + N' ' + TYPE_NAME(c.user_type_id)
    + CASE
        WHEN TYPE_NAME(c.user_type_id) = N'varchar' THEN N'(' + CONVERT(NVARCHAR(10), c.max_length) + N')'
        WHEN TYPE_NAME(c.user_type_id) = N'nvarchar' THEN N'(' + CONVERT(NVARCHAR(10), c.max_length / 2) + N')'
        WHEN TYPE_NAME(c.user_type_id) = N'datetime2' THEN N'(' + CONVERT(NVARCHAR(10), c.scale) + N')'
        ELSE N''
      END
    + CASE WHEN c.is_nullable = 1 THEN N' NULL' ELSE N' NOT NULL' END
    + CASE WHEN c.is_identity = 1 THEN N' IDENTITY' ELSE N'' END
    + ISNULL(N' COLLATE ' + c.collation_name, N'') AS description
  FROM sys.columns c
  WHERE c.object_id = OBJECT_ID(N'rocci121_toby.ExternalMatchReport')
  ORDER BY c.column_id;
`;

export interface RechargedSchemaReport {
  readonly applied: boolean;
  readonly status: "created" | "dry run: created, checked and rolled back" | "nothing to change";
  readonly createdObjects: readonly string[];
}

class DryRun extends Error {
  readonly report: RechargedSchemaReport;

  constructor(report: RechargedSchemaReport) {
    super("Dry run: rolled back.");
    this.name = "DryRun";
    this.report = report;
  }
}

interface NameRecord extends Row {
  name: string;
}

interface ColumnRecord extends Row {
  description: string;
}

interface CountRecord extends Row {
  report_rows: number;
}

async function objectNames(db: Queries): Promise<Set<string>> {
  const rows = await db.rows<NameRecord>(OBJECTS_QUERY);
  return new Set(rows.map((row) => row.name));
}

async function tableColumns(db: Queries): Promise<string[]> {
  const rows = await db.rows<ColumnRecord>(COLUMNS_QUERY);
  return rows.map((row) => row.description);
}

/** The new table's rows; null when the count could not be read (never 0 by mistake). */
async function reportRows(db: Queries): Promise<number | null> {
  const row = await db.row<CountRecord>(sql`SELECT COUNT(*) AS report_rows FROM rocci121_toby.ExternalMatchReport;`);
  return row ? row.report_rows : null;
}

const sameList = (actual: readonly string[], expected: readonly string[]): boolean =>
  actual.length === expected.length && actual.every((value, index) => value === expected[index]);

const sorted = (values: Iterable<string>): string[] => [...values].sort((a, b) => a.localeCompare(b));

/** What keeps an existing table from being the expected one; empty when it is. */
function existingTableProblems(objects: ReadonlySet<string>, columns: readonly string[]): string[] {
  const problems: string[] = [];
  const missing = EXPECTED_OBJECTS.filter((name) => !objects.has(name));
  if (missing.length) problems.push(`missing ${missing.join(", ")}`);
  if (!sameList(columns, EXPECTED_COLUMNS)) problems.push("other columns");
  return problems;
}

export async function applyRechargedSchema(
  database: Pick<Database, "transaction">,
  options: { readonly apply: boolean },
): Promise<RechargedSchemaReport> {
  try {
    return await database.transaction(async (tx) => {
      const before = await objectNames(tx);
      if (before.has(REPORT_TABLE)) {
        const problems = existingTableProblems(before, await tableColumns(tx));
        if (problems.length) {
          throw new Error(`${REPORT_TABLE} exists but differs (${problems.join("; ")}); nothing was changed.`);
        }
        return { applied: false, status: "nothing to change", createdObjects: [] };
      }

      await tx.execute(sql.raw(CREATE_REPORT_TABLE_SQL));

      const after = await objectNames(tx);
      const created = sorted([...after].filter((name) => !before.has(name)));
      const removed = sorted([...before].filter((name) => !after.has(name)));
      const problems: string[] = [];
      if (removed.length) problems.push(`objects disappeared: ${removed.join(", ")}`);
      if (!sameList(created, sorted(EXPECTED_OBJECTS))) problems.push(`new objects: ${created.join(", ")}`);
      if (!sameList(await tableColumns(tx), EXPECTED_COLUMNS)) problems.push("the columns differ");
      if ((await reportRows(tx)) !== 0) problems.push("the new table is not empty");
      if (problems.length) throw new Error(`Recharged schema check failed (${problems.join("; ")}); rolled back.`);

      if (!options.apply) {
        throw new DryRun({
          applied: false,
          status: "dry run: created, checked and rolled back",
          createdObjects: created,
        });
      }
      return { applied: true, status: "created", createdObjects: created };
    });
  } catch (error) {
    if (error instanceof DryRun) return error.report;
    throw error;
  }
}
