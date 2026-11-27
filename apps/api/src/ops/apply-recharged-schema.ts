// npm run ops:recharged-schema [-- --apply]: the Recharged API's table rocci121_toby.ExternalMatchReport
// (modules/recharged/schema.ts, docs/adr/0016) in the database of apps/api/.env. Without --apply a dry run: the whole
// change in one transaction, checked, then rolled back. With --apply the same, committed. Nothing existing changes, and
// it can run again: once the table exists in full it reports "nothing to change". A one-off migration: deleted once
// applied (docs/adr/0014).

import { applyRechargedSchema } from "../modules/recharged/schema.ts";
import { runOperation } from "./run-operation.ts";

const apply = process.argv.slice(2).includes("--apply");

await runOperation("ops:recharged-schema", async ({ database }) => {
  const report = await applyRechargedSchema(database, { apply });
  return {
    step: "schema",
    applied: report.applied,
    status: report.status,
    created_objects: report.createdObjects,
    ...(report.status.startsWith("dry run") ? { hint: "commit it with -- --apply" } : {}),
  };
});
