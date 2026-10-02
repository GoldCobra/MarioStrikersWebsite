// npm run ops:title-order [-- --apply]: the title list's category order and the TOURNAMENT WINNER rule of
// 2026-10-02 in the database (modules/titles/title-order.ts). Without --apply it only reports what it would
// change; with it, both title tables are backed up first and exactly 4 categories and 2 titles change in one
// transaction. The API's title catalog cache takes the change within five minutes.

import { TITLE_ORDER_BACKUPS, applyTitleOrder } from "../modules/titles/title-order.ts";
import { runOperation } from "./run-operation.ts";

const apply = process.argv.includes("--apply");

await runOperation("ops:title-order", async ({ database }) => {
  const report = await applyTitleOrder(database, apply);
  return {
    applied: report.applied,
    status: report.status,
    category_sort_order: report.categorySortOrder,
    ungrouped_titles: report.ungroupedTitles,
    backups: report.applied ? TITLE_ORDER_BACKUPS : [],
  };
});
