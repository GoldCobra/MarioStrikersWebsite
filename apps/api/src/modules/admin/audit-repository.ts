// SQL of the admin audit log: the live AdminAuditStore (audit.ts) on dbo.WebsiteAdminAudit. Rows older than
// AUDIT_RETENTION_DAYS go once a day, with the next record.

import { normalizeText } from "@ms/shared/text";
import type { Queries } from "../../db/database.ts";
import { sql, t } from "../../db/sql.ts";
import { toActivityIso } from "../../lib/dates.ts";
import type { AdminAuditEntry, AdminAuditStore } from "./audit.ts";

export const AUDIT_RETENTION_DAYS = 180;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** An entry of the admin page's list; the address and the details stay in the table. */
interface AuditRecord {
  AtUtc: Date;
  DiscordUserId: string;
  Action: string;
  Target: string | null;
  Outcome: string;
}

/** A value cut to its column, so an unusual one never fails the write; "" becomes NULL. */
function clip(value: unknown, length: number): string | null {
  const text = normalizeText(value);
  return text ? text.slice(0, length) : null;
}

function toAuditEntry(row: AuditRecord): AdminAuditEntry {
  return {
    at: toActivityIso(row.AtUtc) ?? "",
    discordUserId: normalizeText(row.DiscordUserId),
    action: normalizeText(row.Action),
    target: normalizeText(row.Target),
    outcome: normalizeText(row.Outcome),
  };
}

export function createSqlAdminAuditStore(db: Queries, now: () => number = Date.now): AdminAuditStore {
  let prunedAt = 0;
  return {
    async record(event) {
      const prune = now() - prunedAt >= PRUNE_INTERVAL_MS;
      // The prune flag is a parameter, so recording keeps one statement (and one plan) whether it prunes or not.
      await db.execute(sql`
        INSERT INTO dbo.WebsiteAdminAudit (DiscordUserId, Action, Target, Outcome, Ip, RequestId, Details)
        VALUES (
          ${t.varchar(clip(event.discordUserId, 20) ?? "", 20)},
          ${t.varchar(clip(event.action, 64) ?? "", 64)},
          ${t.nvarchar(clip(event.target, 200), 200)},
          ${t.varchar(event.outcome, 16)},
          ${t.varchar(clip(event.ip, 45), 45)},
          ${t.varchar(clip(event.requestId, 64), 64)},
          ${t.nvarchar(clip(event.details, 2000), 2000)}
        );
        IF ${t.bit(prune)} = 1
          DELETE FROM dbo.WebsiteAdminAudit
          WHERE AtUtc < DATEADD(DAY, -${sql.raw(String(AUDIT_RETENTION_DAYS))}, SYSUTCDATETIME());
      `);
      if (prune) prunedAt = now();
    },

    async recent(limit) {
      const rows = await db.rows<AuditRecord>(sql`
        SELECT TOP (${limit}) AtUtc, DiscordUserId, Action, Target, Outcome
        FROM dbo.WebsiteAdminAudit
        ORDER BY AtUtc DESC, Id DESC;
      `);
      return rows.map(toAuditEntry);
    },
  };
}
