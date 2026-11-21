// The member's club on My Club, on the club popup's card (club-card.ts): the member's role, the club's settings
// (club-edit.ts), its logo, its activity, the roster with what the member may do to each one, the club's
// invitations with "Invite to Club", and leaving or deleting the club. Each change answers with the whole state;
// update() draws it again and keeps a settings draft that is not saved yet.

import { escapeHtml } from "@ms/shared/html";
import { CLUB_LIMITS, CLUB_LOGO_LIMITS } from "@ms/shared/clubs";
import { renderClubLogo, renderClubName, rosterItemHtml } from "../clubs/club-profile-view.ts";
import { showToast } from "../profile/profile-toasts.ts";
import { createClubCard, dateText, lineButton, lineTextHtml, noteHtml, rowHtml, sectionHtml } from "./club-card.ts";
import { createClubEditor, type ClubEditor, type SubmitResult } from "./club-edit.ts";
import {
  MY_CLUB_URL,
  clubRequest,
  settingsOf,
  type InviteCandidates,
  type MyClub,
  type MyClubMember,
  type MyClubState,
} from "./my-club-data.ts";
import type { MyClubContext, MyClubView } from "./my-club-page.ts";

const ROLE_NAMES = { captain: "Captain", officer: "Officer", member: "Member" } as const;
const SEARCH_DELAY_MS = 300;
const LOGO_TYPES: readonly string[] = CLUB_LOGO_LIMITS.types;

type Confirming =
  | { readonly kind: "remove"; readonly playerId: number }
  | { readonly kind: "leave" }
  | { readonly kind: "delete" }
  | null;

export function createClubView(context: MyClubContext, initial: MyClubState & { club: MyClub }): MyClubView {
  const card = createClubCard();
  let club: MyClub = initial.club;
  let confirming: Confirming = null;
  let busy = false;
  let candidates: InviteCandidates | null = null;
  let query = "";
  let page = 1;
  let searchTimer: number | undefined;
  let candidatesAsked = 0;

  card.content.insertAdjacentHTML(
    "beforeend",
    [
      '<div class="profile-top-line my-club-top-line" data-my-club="top"></div>',
      '<div data-my-club="notices"></div>',
      '<div data-my-club="settings"></div>',
      '<div data-my-club="logo"></div>',
      '<div data-my-club="activity"></div>',
      '<div data-my-club="roster"></div>',
      '<div data-my-club="invitations"></div>',
      '<div data-my-club="leave"></div>',
    ].join(""),
  );
  const part = (key: string): HTMLElement => {
    const node = card.content.querySelector<HTMLElement>(`[data-my-club="${key}"]`);
    if (!node) throw new Error(`Missing part ${key}.`);
    return node;
  };

  const manager = (): boolean => club.role === "captain" || club.role === "officer";

  async function submitSettings(request: Record<string, unknown>): Promise<SubmitResult> {
    const response = await context.act("PUT", `${MY_CLUB_URL}/settings`, request, {
      own: ["VALIDATION_FAILED", "CLUB_CHANGED"],
    });
    if (response.ok) return { kind: "done" };
    if (response.error.code === "VALIDATION_FAILED") return { kind: "fields", fields: response.error.fields ?? [] };
    if (response.error.code === "CLUB_CHANGED") {
      const current = await clubRequest<MyClubState>("GET", MY_CLUB_URL);
      const now = current.body?.club;
      if (now) {
        // The rest of the page shows the new state; the editor lays the draft on top itself.
        club = now;
        drawAllButSettings();
        return { kind: "changed", saved: settingsOf(now), version: now.settings_version };
      }
      showToast({ text: "The club's settings could not be loaded again. Reload the page.", level: "error" });
    }
    return { kind: "failed" };
  }

  const editor: ClubEditor = createClubEditor({
    root: card.root,
    mount: part("settings"),
    mode: "settings",
    saved: settingsOf(club),
    version: club.settings_version,
    editable: club.permissions.edit_settings,
    submit: submitSettings,
  });

  // -------------------------------------------------------------------------------------------------
  // Parts

  function drawTop(): void {
    part("top").innerHTML = [
      `<p class="profile-club-line">Your role: <span class="profile-club-name">${ROLE_NAMES[club.role]}</span></p>`,
      club.created_at ? `<p class="profile-discord-name">Created ${escapeHtml(dateText(club.created_at))}</p>` : "",
    ].join("");
  }

  function drawNotices(): void {
    const notices: string[] = [];
    if (club.inactive_at && club.deletion_at) {
      notices.push(
        `A new club needs at least 2 members for ${String(CLUB_LIMITS.streakDays)} days in a row. Until then it is marked inactive on ${dateText(club.inactive_at)} and deleted on ${dateText(club.deletion_at)}.`,
      );
    }
    part("notices").innerHTML = notices
      .map((text) => `<p class="profile-edit-notice my-club-notice">${escapeHtml(text)}</p>`)
      .join("");
  }

  function drawLogo(): void {
    if (!club.permissions.edit_settings) {
      part("logo").innerHTML = "";
      return;
    }
    const preview = club.logo
      ? `<img class="my-club-logo-preview" src="${escapeHtml(club.logo)}" alt="" width="48" height="48">`
      : '<span class="player-popup-code-value">No logo uploaded</span>';
    const buttons = [
      `<label class="profile-action-button my-club-line-button my-club-upload">${club.logo ? "Change" : "Upload"}<input type="file" accept="${LOGO_TYPES.join(",")}" data-club-action="logo-file" hidden></label>`,
      club.logo ? lineButton("logo-remove", "Remove") : "",
    ].join("");
    part("logo").innerHTML = sectionHtml(
      "logo",
      "Logo",
      `<div class="player-popup-code-list">${rowHtml(`${preview}<span class="my-club-line-actions">${buttons}</span>`, club.logo ? "" : " profile-code-missing")}<p class="profile-row-hint">PNG, JPG or WebP, at most 2 MB, between 256×256 and 2048×2048 pixels.</p></div>`,
    );
  }

  function drawActivity(): void {
    const last = club.activity ? `Last activity ${dateText(club.activity)}` : "No activity confirmed yet";
    const status = club.is_active
      ? "Active"
      : `Inactive: no activity in the last ${String(CLUB_LIMITS.activityDays)} days`;
    const confirm = club.permissions.confirm_activity
      ? `<span class="my-club-line-actions">${lineButton("activity", "Confirm Activity")}</span>`
      : "";
    part("activity").innerHTML = sectionHtml(
      "activity",
      "Activity",
      `<div class="player-popup-code-list">${rowHtml(`${lineTextHtml(last, status)}${confirm}`, club.is_active ? "" : " profile-code-missing")}</div>`,
    );
  }

  function memberActions(member: MyClubMember): string {
    if (confirming?.kind === "remove" && confirming.playerId === member.player_id) {
      return `<span class="my-club-line-actions">${lineButton("remove-confirm", "Yes, remove", `data-player="${String(member.player_id)}"`, "danger")}${lineButton("keep", "Keep")}</span>`;
    }
    const buttons = [
      member.actions.promote ? lineButton("promote", "Promote", `data-player="${String(member.player_id)}"`) : "",
      member.actions.demote ? lineButton("demote", "Demote", `data-player="${String(member.player_id)}"`) : "",
      member.actions.remove ? lineButton("remove", "Remove", `data-player="${String(member.player_id)}"`) : "",
    ].join("");
    return buttons ? `<span class="my-club-line-actions">${buttons}</span>` : "";
  }

  function drawRoster(): void {
    const items = club.members
      .map((member) =>
        rosterItemHtml(
          {
            name: member.name,
            country: member.country,
            // Where the Discord username stands: the captain and the officers see who left the server.
            discord_name: member.absent && manager() ? "not on the server" : member.discord_name,
            role: member.role,
          },
          memberActions(member),
        ),
      )
      .join("");
    const officers = `Officers ${String(club.officers.count)} of ${String(club.officers.max)}`;
    part("roster").innerHTML = sectionHtml(
      "roster",
      `Roster (${String(club.members.length)})`,
      `<p class="profile-row-hint my-club-section-hint">${escapeHtml(officers)}</p><ul class="club-popup-roster my-club-roster">${items}</ul>`,
    );
  }

  function candidatesHtml(): string {
    if (!candidates) return '<p class="profile-row-hint">Loading players…</p>';
    if (!candidates.candidates.length) {
      return `<p class="profile-row-hint">${query ? "No player matches this search." : "No player can be invited right now."}</p>`;
    }
    const rows = candidates.candidates
      .map((candidate) => {
        const until = candidate.invitable_from;
        const action = until
          ? noteHtml("Again from", dateText(until))
          : lineButton("invite", "Invite", `data-player="${String(candidate.player_id)}"`);
        return rosterItemHtml(
          { name: candidate.name, country: candidate.country, discord_name: candidate.discord_name },
          `<span class="my-club-line-actions">${action}</span>`,
        );
      })
      .join("");
    const pages = Math.max(1, Math.ceil(candidates.total / 20));
    const pager =
      pages > 1
        ? `<p class="my-club-pager">${lineButton("page-prev", "Previous", candidates.page <= 1 ? "disabled" : "")}<span>Page ${String(candidates.page)} of ${String(pages)}</span>${lineButton("page-next", "Next", candidates.page >= pages ? "disabled" : "")}</p>`
        : "";
    return `<ul class="club-popup-roster my-club-roster">${rows}</ul>${pager}`;
  }

  function drawInvitations(): void {
    if (!club.permissions.invite) {
      part("invitations").innerHTML = "";
      return;
    }
    const open = club.invitations
      .map((invitation) =>
        rowHtml(
          `${lineTextHtml(invitation.name, `Invited by ${invitation.invited_by} · open until ${dateText(invitation.expires_at)}`)}<span class="my-club-line-actions">${lineButton("revoke", "Revoke", `data-invitation="${String(invitation.id)}"`)}</span>`,
        ),
      )
      .join("");
    const full = club.invitations.length >= CLUB_LIMITS.maxOpenInvitations;
    part("invitations").innerHTML =
      sectionHtml(
        "invitations",
        `Open Invitations (${String(club.invitations.length)} of ${String(CLUB_LIMITS.maxOpenInvitations)})`,
        `<div class="player-popup-code-list">${open || rowHtml('<span class="player-popup-code-value">No open invitations</span>', " profile-code-missing")}</div>`,
      ) +
      sectionHtml(
        "invite",
        "Invite to Club",
        full
          ? `<p class="profile-row-hint">A club can have at most ${String(CLUB_LIMITS.maxOpenInvitations)} open invitations.</p>`
          : `<div class="player-popup-code-list"><input class="profile-edit-text my-club-search" type="search" data-club-action="search" value="${escapeHtml(query)}" placeholder="Search players" aria-label="Search players to invite" autocomplete="off" spellcheck="false"></div><p class="profile-row-hint">Players with a profile, in no club and on the Discord server.</p><div data-my-club="candidates">${candidatesHtml()}</div>`,
      );
  }

  function drawLeave(): void {
    const buttons: string[] = [];
    if (confirming?.kind === "leave") {
      const alone = club.members.length <= 1;
      const text =
        club.role === "captain"
          ? alone
            ? "You are the only member: leaving deletes the club."
            : "You are the captain: the first officer (or member) in the roster takes over."
          : `Leave ${club.name}?`;
      part("leave").innerHTML =
        `<p class="profile-edit-notice my-club-notice">${escapeHtml(text)}</p><p class="profile-state-actions">${lineButton("leave-confirm", "Yes, leave", "", "danger")} ${lineButton("keep", "Stay")}</p>`;
      return;
    }
    if (confirming?.kind === "delete") {
      part("leave").innerHTML = [
        `<p class="profile-edit-notice my-club-notice">Deleting removes the club for good: every member becomes club-less, and its name and tag are free again. Type the tag <strong>${escapeHtml(club.tag)}</strong> to confirm.</p>`,
        `<p class="profile-state-actions"><input class="profile-edit-text my-club-confirm-tag" type="text" data-club-action="confirm-tag" aria-label="The club's tag" autocomplete="off" spellcheck="false"> <span class="my-club-confirm-buttons">${lineButton("delete-confirm", "Delete Club", "disabled", "danger")} ${lineButton("keep", "Keep Club")}</span></p>`,
      ].join("");
      return;
    }
    if (club.permissions.leave) buttons.push(lineButton("leave", "Leave Club"));
    if (club.permissions.delete_club) buttons.push(lineButton("delete", "Delete Club", "", "danger"));
    part("leave").innerHTML = buttons.length
      ? `<p class="profile-state-actions my-club-leave">${buttons.join(" ")}</p>`
      : "";
  }

  function drawAllButSettings(): void {
    renderClubName(card.view, club);
    renderClubLogo(card.view, club);
    drawTop();
    drawNotices();
    drawLogo();
    drawActivity();
    drawRoster();
    drawInvitations();
    drawLeave();
  }

  // -------------------------------------------------------------------------------------------------
  // Actions

  async function run(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown, success?: string): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const response = await context.act(method, path, body, { success });
      if (response.ok) confirming = null;
    } finally {
      busy = false;
    }
  }

  async function loadCandidates(): Promise<void> {
    if (!club.permissions.invite) return;
    // Only the newest request is shown: an older search or page that answers late is dropped.
    const ticket = ++candidatesAsked;
    const params = new URLSearchParams({ q: query, page: String(page) });
    const response = await clubRequest<InviteCandidates>(
      "GET",
      `${MY_CLUB_URL}/invite-candidates?${params.toString()}`,
    );
    if (ticket !== candidatesAsked) return;
    candidates = response.body ?? { total: 0, page: 1, candidates: [] };
    const mount = card.content.querySelector<HTMLElement>('[data-my-club="candidates"]');
    if (mount) mount.innerHTML = candidatesHtml();
  }

  async function uploadLogo(file: File): Promise<void> {
    if (!LOGO_TYPES.includes(file.type)) {
      showToast({ text: "Upload a PNG, JPG or WebP image.", level: "error" });
      return;
    }
    if (file.size > CLUB_LOGO_LIMITS.maxBytes) {
      showToast({ text: "The logo may be at most 2 MB.", level: "error" });
      return;
    }
    await run("PUT", `${MY_CLUB_URL}/logo`, file, "Logo saved.");
  }

  card.root.addEventListener("click", (event) => {
    const element = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-club-action]") : null;
    if (
      !element ||
      (element instanceof HTMLButtonElement && element.disabled) ||
      element.getAttribute("aria-disabled") === "true"
    ) {
      return;
    }
    const player = element.dataset.player ?? "";
    switch (element.dataset.clubAction) {
      case "promote":
        void run("PUT", `${MY_CLUB_URL}/members/${player}/officer`, { officer: true }, "Promoted to officer.");
        break;
      case "demote":
        void run("PUT", `${MY_CLUB_URL}/members/${player}/officer`, { officer: false }, "No longer an officer.");
        break;
      case "remove":
        confirming = { kind: "remove", playerId: Number(player) };
        drawRoster();
        break;
      case "remove-confirm":
        void run("POST", `${MY_CLUB_URL}/members/${player}/remove`, undefined, "Member removed.");
        break;
      case "keep":
        confirming = null;
        drawRoster();
        drawLeave();
        break;
      case "activity":
        void run("POST", `${MY_CLUB_URL}/activity`, undefined, "Activity confirmed.");
        break;
      case "logo-remove":
        void run("DELETE", `${MY_CLUB_URL}/logo`, undefined, "Logo removed.");
        break;
      case "revoke":
        void run(
          "DELETE",
          `${MY_CLUB_URL}/invitations/${element.dataset.invitation ?? ""}`,
          undefined,
          "Invitation revoked.",
        );
        break;
      case "invite":
        void run("POST", `${MY_CLUB_URL}/invitations`, { player_id: Number(player) }, "Invitation sent.").then(
          loadCandidates,
        );
        break;
      case "page-prev":
        page = Math.max(1, page - 1);
        void loadCandidates();
        break;
      case "page-next":
        page += 1;
        void loadCandidates();
        break;
      case "leave":
        confirming = { kind: "leave" };
        drawLeave();
        break;
      case "leave-confirm":
        void run("POST", `${MY_CLUB_URL}/leave`, undefined, "You left the club.");
        break;
      case "delete":
        confirming = { kind: "delete" };
        drawLeave();
        card.content.querySelector<HTMLElement>(".my-club-confirm-tag")?.focus();
        break;
      case "delete-confirm": {
        const typed = card.content.querySelector<HTMLInputElement>(".my-club-confirm-tag")?.value.trim() ?? "";
        void run("POST", `${MY_CLUB_URL}/delete`, { confirm_tag: typed }, "The club was deleted.");
        break;
      }
    }
  });
  card.root.addEventListener("input", (event) => {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    if (input?.dataset.clubAction === "search") {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        query = input.value.trim();
        page = 1;
        void loadCandidates();
      }, SEARCH_DELAY_MS);
    } else if (input?.dataset.clubAction === "confirm-tag") {
      const button = card.content.querySelector<HTMLButtonElement>('[data-club-action="delete-confirm"]');
      if (button) button.disabled = input.value.trim() !== club.tag;
    }
  });
  card.root.addEventListener("change", (event) => {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    const file = input?.dataset.clubAction === "logo-file" ? input.files?.[0] : undefined;
    if (input && file) {
      void uploadLogo(file);
      input.value = "";
    }
  });

  drawAllButSettings();
  void loadCandidates();

  return {
    root: card.root,
    clubId: club.club_id,
    update(state) {
      if (!state.club) return;
      const invited = state.club.invitations.length !== club.invitations.length;
      club = state.club;
      editor.setSaved(settingsOf(club), club.settings_version);
      drawAllButSettings();
      if (invited) void loadCandidates();
    },
  };
}
