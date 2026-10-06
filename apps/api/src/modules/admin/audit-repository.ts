// SQL of the admin audit log: dbo.WebsiteAdminAudit (npm run ops:admin-audit creates it) and the live store.
// Rows older than AUDIT_RETENTION_DAYS go once a day, with the next record.

import { normalizeText } from "@ms/shared/text";
import type { Database } from "../../db/database.ts";
import { mssql } from "../../db/database.ts";
import { toActivityIso } from "../../lib/dates.ts";
import type { AdminAuditEntry, AdminAuditStore } from "./audit.ts";

type Row = Record<string, unknown>;

export const AUDIT_RETENTION_DAYS = 180;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------------------------------
// Schema (ops:admin-audit). Created only when missing; nothing existing is changed.

export const AUDIT_SCHEMA_SQL = [
  "SET XACT_ABORT ON;",
  "IF OBJECT_ID(N'dbo.WebsiteAdminAudit', N'U') IS NULL",
  "BEGIN",
  "CREATE TABLE dbo.WebsiteAdminAudit (",
  "  Id BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_WebsiteAdminAudit PRIMARY KEY,",
  "  AtUtc DATETIME2 NOT NULL CONSTRAINT DF_WebsiteAdminAudit_AtUtc DEFAULT (SYSUTCDATETIME()),",
  "  DiscordUserId VARCHAR(20) NOT NULL,",
  "  Action VARCHAR(64) NOT NULL,",
  "  Target NVARCHAR(200) NULL,",
  "  Outcome VARCHAR(16) NOT NULL",
  "    CONSTRAINT CK_WebsiteAdminAudit_Outcome CHECK (Outcome IN ('allowed', 'denied', 'failed')),",
  "  Ip VARCHAR(45) NULL,",
  "  RequestId VARCHAR(64) NULL,",
  "  Details NVARCHAR(2000) NULL",
  ");",
  "CREATE INDEX IX_WebsiteAdminAudit_AtUtc ON dbo.WebsiteAdminAudit (AtUtc DESC);",
  "END",
].join(" ");

export const AUDIT_SCHEMA_STATE_QUERY = "SELECT OBJECT_ID(N'dbo.WebsiteAdminAudit', N'U') AS audit_table;";

export interface AdminAuditSchemaReport {
  readonly applied: boolean;
  readonly auditTable: "exists" | "missing" | "created";
}

/** Creates dbo.WebsiteAdminAudit when missing; without `apply` it only reports whether it exists. */
export async function applyAdminAuditSchema(
  database: Pick<Database, "withTransaction">,
  apply: boolean,
): Promise<AdminAuditSchemaReport> {
  return database.withTransaction(async (transaction) => {
    const exists = async (): Promise<boolean> => {
      const row = ((await transaction.request().query(AUDIT_SCHEMA_STATE_QUERY)).recordset as Row[])[0];
      return row?.audit_table !== null && row?.audit_table !== undefined;
    };
    if (await exists()) return { applied: false, auditTable: "exists" };
    if (!apply) return { applied: false, auditTable: "missing" };
    await transaction.request().query(AUDIT_SCHEMA_SQL);
    if (!(await exists())) throw new Error("dbo.WebsiteAdminAudit still missing after the change; rolled back.");
    return { applied: true, auditTable: "created" };
  });
}

// ---------------------------------------------------------------------------------------------------
// Reading and writing

/** A value cut to its column, so an unusual one never fails the write; "" becomes NULL. */
function clip(value: unknown, length: number): string | null {
  const text = normalizeText(value);
  return text ? text.slice(0, length) : null;
}

export const RECORD_QUERY = [
  "INSERT INTO dbo.WebsiteAdminAudit (DiscordUserId, Action, Target, Outcome, Ip, RequestId, Details)",
  "VALUES (@discordUserId, @action, @target, @outcome, @ip, @requestId, @details);",
  "IF @prune = 1",
  `  DELETE FROM dbo.WebsiteAdminAudit WHERE AtUtc < DATEADD(DAY, -${String(AUDIT_RETENTION_DAYS)}, SYSUTCDATETIME());`,
].join(" ");

export const RECENT_QUERY = [
  "SELECT TOP (@limit) AtUtc, DiscordUserId, Action, Target, Outcome",
  "FROM dbo.WebsiteAdminAudit ORDER BY AtUtc DESC, Id DESC;",
].join(" ");

export function toAuditEntry(row: Row): AdminAuditEntry {
  return {
    at: toActivityIso(row.AtUtc) ?? "",
    discordUserId: normalizeText(row.DiscordUserId),
    action: normalizeText(row.Action),
    target: normalizeText(row.Target),
    outcome: normalizeText(row.Outcome),
  };
}

export function createSqlAdminAuditStore(
  database: Pick<Database, "withPool">,
  now: () => number = Date.now,
): AdminAuditStore {
  let prunedAt = 0;
  return {
    async record(event) {
      const prune = now() - prunedAt >= PRUNE_INTERVAL_MS;
      await database.withPool((pool) =>
        pool
          .request()
          .input("discordUserId", mssql.VarChar(20), clip(event.discordUserId, 20) ?? "")
          .input("action", mssql.VarChar(64), clip(event.action, 64) ?? "")
          .input("target", mssql.NVarChar(200), clip(event.target, 200))
          .input("outcome", mssql.VarChar(16), event.outcome)
          .input("ip", mssql.VarChar(45), clip(event.ip, 45))
          .input("requestId", mssql.VarChar(64), clip(event.requestId, 64))
          .input("details", mssql.NVarChar(2000), clip(event.details, 2000))
          .input("prune", mssql.Bit, prune)
          .query(RECORD_QUERY),
      );
      if (prune) prunedAt = now();
    },
    async recent(limit) {
      const rows = await database.withPool(async (pool) => {
        const result = await pool.request().input("limit", mssql.Int, limit).query(RECENT_QUERY);
        return result.recordset as Row[];
      });
      return rows.map(toAuditEntry);
    },
  };
}
