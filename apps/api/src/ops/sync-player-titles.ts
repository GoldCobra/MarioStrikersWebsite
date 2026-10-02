// npm run ops:title-sync [-- --apply]: awards the player titles the data allows, the legacy ranks
// included. Without --apply it only reports what it would write: the unlocks per title (each one listed,
// legacy ranks only counted) and the open points, unclear data that awards nothing. With --apply it writes
// them in one transaction and logs the run in dbo.CommandLog; a second run finds nothing new.

import { runTitleSync } from "../modules/titles/service.ts";
import { runOperation } from "./run-operation.ts";

const apply = process.argv.includes("--apply");

await runOperation("ops:title-sync", async ({ database }) => {
  const report = await runTitleSync(database, { apply, legacy: true, grantedBy: "ops:title-sync" });
  return {
    applied: report.applied,
    planned: report.grants.length,
    granted: report.granted,
    new_titles: report.newTitles,
    by_title: report.byTitle,
    grants: report.grants
      .filter((grant) => grant.sourceType !== "LEGACY_RANK")
      .map((grant) => `${grant.titleCode} <- player ${grant.playerId} (${grant.sourceType} ${grant.sourceRef})`),
    open_points: report.openPoints,
  };
});
