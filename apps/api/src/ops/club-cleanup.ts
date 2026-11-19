// npm run ops:club-cleanup -- --ids=3,342,373 [--apply] [--stamp=yyyymmdd]: E1 of the club management plan, the
// one-off deletion of clubs without members (modules/clubs/schema.ts). Only the listed ids, each with what is
// attached to it and one dbo.CommandLog row, and only while it has no member and is in the backup table of the
// day (npm run ops:club-schema -- --backup). Without --apply a dry run that rolls back.

import { deleteEmptyClubs, utcStamp } from "../modules/clubs/schema.ts";
import { runOperation } from "./run-operation.ts";

const args = process.argv.slice(2);
const value = (name: string): string => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
const ids = value("--ids")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean)
  .map(Number);

await runOperation("ops:club-cleanup", async ({ database }) => {
  const report = await deleteEmptyClubs(database, {
    ids,
    apply: args.includes("--apply"),
    stamp: value("--stamp") || utcStamp(new Date()),
  });
  return {
    applied: report.applied,
    status: report.status,
    deleted: report.deleted.map((club) => ({
      club_id: club.clubId,
      public_id: club.publicId,
      tag: club.tag,
      name: club.name,
      owner_discord_id: club.ownerDiscordId,
    })),
    attached_rows_deleted: report.attachedRowsDeleted,
  };
});
