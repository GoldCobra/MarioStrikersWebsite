// npm run ops:club-schema [-- <step>] [-- --stamp=yyyymmdd]: the club management schema in the database
// (modules/clubs/schema.ts, docs/adr/0012). The steps, in this order:
//   --backup         copies dbo.Club, dbo.ClubRoster and dbo._PlayerLobby to *_Backup_<UTC date>
//   (no step)        dry run: the whole change in one transaction, checked, then rolled back
//   --apply          the same, committed; refused without the backup tables of the day
//   --drop-backups   drops the backup tables once the change is verified live
// --stamp picks the backup tables of another day. Nothing existing is changed; it can run again.

import { applyClubSchema, backupClubTables, dropClubBackups, utcStamp } from "../modules/clubs/schema.ts";
import { runOperation } from "./run-operation.ts";

const args = process.argv.slice(2);
const stamp = args.find((arg) => arg.startsWith("--stamp="))?.slice("--stamp=".length) ?? utcStamp(new Date());

await runOperation("ops:club-schema", async ({ database }) => {
  if (args.includes("--backup")) {
    const report = await backupClubTables(database, stamp);
    return { step: "backup", created: report.created };
  }
  if (args.includes("--drop-backups")) {
    const report = await dropClubBackups(database, stamp);
    return { step: "drop backups", dropped: report.dropped };
  }
  const report = await applyClubSchema(database, { apply: args.includes("--apply"), stamp });
  return {
    step: "schema",
    applied: report.applied,
    status: report.status,
    added_columns: report.addedColumns,
    created_tables: report.createdTables,
    created_indexes: report.createdIndexes,
    club_ids_assigned: report.publicIdsAssigned,
    duplicate_names: report.duplicateNames,
    clubs: report.clubs,
    roster_rows: report.rosterRows,
    ...(report.status.startsWith("dry run") ? { hint: "back up (-- --backup), then add -- --apply" } : {}),
  };
});
