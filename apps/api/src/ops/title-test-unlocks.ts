// npm run ops:title-test-unlocks -- --player <id> --grant-all|--revoke [--apply]: temporary test unlocks of
// player titles (modules/titles/title-test-unlocks.ts), kept apart from the regular unlocks. Without --apply
// it only reports what it would grant or remove.

import { runTestUnlocks } from "../modules/titles/title-test-unlocks.ts";
import { runOperation } from "./run-operation.ts";

const argv = process.argv;
const apply = argv.includes("--apply");
const playerIndex = argv.indexOf("--player");
const playerId = playerIndex >= 0 ? Number(argv[playerIndex + 1]) : Number.NaN;
const grantAll = argv.includes("--grant-all");
const revoke = argv.includes("--revoke");

await runOperation("ops:title-test-unlocks", async ({ database }) => {
  if (grantAll === revoke) throw new Error("Pass exactly one of --grant-all and --revoke.");
  const report = await runTestUnlocks(database, {
    playerId,
    mode: grantAll ? "grant-all" : "revoke",
    apply,
    grantedBy: "ops:title-test-unlocks",
  });
  return {
    applied: report.applied,
    player_id: report.playerId,
    mode: report.mode,
    count: report.titles.length,
    titles: report.titles,
    cleared_selection: report.clearedSelection,
    ...(apply ? {} : { hint: "add --apply to write this" }),
  };
});
