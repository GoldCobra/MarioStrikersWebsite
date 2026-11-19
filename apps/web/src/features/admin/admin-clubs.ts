// The admin page's club moderation (club management plan B2, docs/adr/0012) as markup: every club with its
// backend id (F1, shown only here), and an admin's three actions — rename (name and/or tag, by today's rules and
// unique), remove the logo, delete the club (after typing its tag). Pure, so it is tested in Node; admin-page.ts
// loads GET /api/admin/clubs and sends the actions.

import { escapeHtml } from "@ms/shared/html";

export interface AdminClubRow {
  readonly club_id: number;
  readonly public_id: string;
  readonly name: string;
  readonly tag: string;
  readonly members: number;
  /** An uploaded logo or a logo link. */
  readonly has_logo: boolean;
}

/** GET /api/admin/clubs, and every action's answer. */
export interface AdminClubsResponse {
  /** dbo.ClubSystemState: the actions work in mode "admins" and "on". */
  readonly mode: "off" | "admins" | "on";
  readonly clubs: readonly AdminClubRow[];
}

/** What the list shows: a search, and one club's open form. */
export interface AdminClubsView {
  readonly query: string;
  readonly form: { readonly clubId: number; readonly kind: "rename" | "delete" } | null;
}

/** The clubs whose name, tag or backend id contains the query, in any case. */
export function filterClubs(clubs: readonly AdminClubRow[], query: string): AdminClubRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...clubs];
  return clubs.filter((club) =>
    [club.name, club.tag, club.public_id].some((text) => text.toLowerCase().includes(needle)),
  );
}

const button = (action: string, label: string, clubId: number, extra = ""): string =>
  `<button class="profile-action-button my-club-line-button" type="button" data-admin-club="${action}" data-club-id="${String(clubId)}"${extra}>${escapeHtml(label)}</button>`;

function clubLine(club: AdminClubRow, view: AdminClubsView, enabled: boolean): string {
  const label = `${club.name} [${club.tag}]`;
  const facts = `ID ${club.public_id} · ${String(club.members)} member${club.members === 1 ? "" : "s"}`;
  const open = view.form?.clubId === club.club_id ? view.form.kind : null;
  let actions: string;
  if (open === "rename") {
    actions = [
      `<input class="profile-edit-text admin-club-input" type="text" data-admin-field="name" value="${escapeHtml(club.name)}" maxlength="50" aria-label="New name of ${escapeHtml(label)}" autocomplete="off" spellcheck="false">`,
      `<input class="profile-edit-text admin-club-input is-tag" type="text" data-admin-field="tag" value="${escapeHtml(club.tag)}" maxlength="5" aria-label="New tag of ${escapeHtml(label)}" autocomplete="off" spellcheck="false">`,
      button("rename-save", "Save", club.club_id),
      button("cancel", "Cancel", club.club_id),
    ].join(" ");
  } else if (open === "delete") {
    actions = [
      `<input class="profile-edit-text admin-club-input is-tag" type="text" data-admin-field="confirm" aria-label="Type ${escapeHtml(club.tag)} to delete ${escapeHtml(label)}" placeholder="${escapeHtml(club.tag)}" autocomplete="off" spellcheck="false">`,
      button("delete-confirm", "Delete for good", club.club_id, " disabled"),
      button("cancel", "Keep", club.club_id),
    ].join(" ");
  } else {
    const off = enabled ? "" : " disabled";
    actions = [
      button("rename", "Rename", club.club_id, off),
      club.has_logo ? button("logo", "Remove Logo", club.club_id, off) : "",
      button("delete", "Delete", club.club_id, off),
    ]
      .filter(Boolean)
      .join(" ");
  }
  return `<li class="admin-club" data-club-row="${String(club.club_id)}"><strong>${escapeHtml(label)}</strong> <span class="admin-club-facts">${escapeHtml(facts)}</span><span class="admin-club-actions">${actions}</span></li>`;
}

/** The list alone: drawn again while the search keeps its field (and the focus). */
export function adminClubListHtml(response: AdminClubsResponse, view: AdminClubsView): string {
  const enabled = response.mode !== "off";
  const clubs = filterClubs(response.clubs, view.query);
  return clubs.length
    ? `<ul class="admin-clubs">${clubs.map((club) => clubLine(club, view, enabled)).join("")}</ul>`
    : "<p>No club matches this search.</p>";
}

export function adminClubsHtml(response: AdminClubsResponse, view: AdminClubsView): string {
  return [
    "<h3>Clubs</h3>",
    response.mode !== "off"
      ? "<p>Rename a club (name and/or tag, on a request made by hand), remove its logo or delete it. Every action is logged.</p>"
      : "<p>Club management is off: the actions open once My Club is in mode admins or on.</p>",
    `<p><input class="profile-edit-text my-club-search" type="search" data-admin-field="search" value="${escapeHtml(view.query)}" placeholder="Search by name, tag or ID" aria-label="Search clubs" autocomplete="off" spellcheck="false"></p>`,
    '<p class="admin-club-status" data-admin-club-status role="status"></p>',
    `<div data-admin-club-list>${adminClubListHtml(response, view)}</div>`,
  ].join("");
}
