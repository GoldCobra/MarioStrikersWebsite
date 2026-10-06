// The admin page's overview (docs/adr/0011) as markup: who is signed in, how long the admin access lasts, and
// the latest admin activity. Pure, so it is tested in Node; admin-page.ts loads the data and shows it.

import { escapeHtml } from "@ms/shared/html";

export interface AdminAuditRow {
  readonly at: string;
  readonly discord_user_id: string;
  readonly action: string;
  readonly target: string;
  readonly outcome: string;
}

/** GET /api/admin/overview. */
export interface AdminOverviewResponse {
  readonly admin: { readonly discord_user_id: string; readonly username: string; readonly global_name: string };
  readonly access_until: string;
  readonly role_checked_at: string;
  /** null when the log could not be read. */
  readonly audit: readonly AdminAuditRow[] | null;
}

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

/** "6 Oct 2026, 18:01 UTC", or "-" for a missing or invalid date. */
export function formatUtc(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? `${DATE_TIME.format(time)} UTC` : "-";
}

function auditLine(row: AdminAuditRow): string {
  const parts = [formatUtc(row.at), row.action, row.outcome, row.target, `Discord ${row.discord_user_id}`].filter(
    (part) => part.trim() !== "",
  );
  return `<li>${parts.map((part) => escapeHtml(part)).join(" · ")}</li>`;
}

export function adminOverviewHtml(overview: AdminOverviewResponse): string {
  const { admin } = overview;
  const name = admin.global_name || admin.username || admin.discord_user_id;
  const handle = admin.username && admin.username !== name ? ` (${admin.username})` : "";
  const activity =
    overview.audit === null
      ? "<p>The admin log is unavailable right now.</p>"
      : overview.audit.length === 0
        ? "<p>No admin activity recorded yet.</p>"
        : `<ul>${overview.audit.map(auditLine).join("")}</ul>`;
  return [
    "<h2>Admin</h2>",
    `<p>Signed in as <strong>${escapeHtml(name)}</strong>${escapeHtml(handle)}.</p>`,
    "<ul>",
    `<li>Admin access until ${escapeHtml(formatUtc(overview.access_until))}; log in again after that.</li>`,
    `<li>Discord role confirmed ${escapeHtml(formatUtc(overview.role_checked_at))}.</li>`,
    "</ul>",
    "<h3>Recent admin activity</h3>",
    activity,
  ].join("");
}
