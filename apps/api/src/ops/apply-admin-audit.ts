// npm run ops:admin-audit [-- --apply]: creates dbo.WebsiteAdminAudit, the admin page's audit log
// (modules/admin/audit-repository.ts, docs/adr/0011), when it is missing. Without --apply it only reports whether the
// table exists. Run it before switching the admin page on (ADMIN_ENABLED); nothing existing is changed.

import { applyAdminAuditSchema } from "../modules/admin/audit-repository.ts";
import { runOperation } from "./run-operation.ts";

const apply = process.argv.includes("--apply");

await runOperation("ops:admin-audit", async ({ database }) => {
  const report = await applyAdminAuditSchema(database, apply);
  return {
    applied: report.applied,
    audit_table: report.auditTable,
    ...(report.auditTable === "missing" ? { hint: "add -- --apply to create it" } : {}),
  };
});
