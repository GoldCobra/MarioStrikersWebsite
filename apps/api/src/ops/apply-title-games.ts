// npm run ops:title-games [-- --schema] [-- --apply]: the per-game titles of 2026-10-02 in the database
// (modules/titles/title-games.ts). --schema adds the GameCode column and the test unlock table (run it before
// the release that reads them). Without --schema the data step runs: without --apply as a dry run whose
// changes are rolled back, with it committed. The API's title catalog cache takes the change within five
// minutes.

import { TITLE_GAMES_BACKUPS, applyTitleGames, applyTitleGamesSchema } from "../modules/titles/title-games.ts";
import { runOperation } from "./run-operation.ts";

const apply = process.argv.includes("--apply");
const schema = process.argv.includes("--schema");

await runOperation("ops:title-games", async ({ database }) => {
  if (schema) {
    const report = await applyTitleGamesSchema(database, apply);
    return {
      step: "schema",
      applied: report.applied,
      game_code_column: report.gameCodeColumn,
      test_unlock_table: report.testUnlockTable,
      ...(apply ? {} : { hint: "add -- --apply to create what is missing" }),
    };
  }
  const report = await applyTitleGames(database, apply);
  return {
    step: "data",
    applied: report.applied,
    status: report.status,
    inserted_titles: report.insertedTitles,
    changed_rows: report.changedRows,
    new_variants: report.newVariants,
    granted: report.granted,
    grants_by_title: report.grantsByTitle,
    moved_selections: report.movedSelections,
    cleared_selections: report.clearedSelections,
    lapsed_unlocks: report.lapsed,
    invalid_before: report.invalidBefore,
    open_points: report.openPoints,
    backups: report.applied ? TITLE_GAMES_BACKUPS : [],
  };
});
