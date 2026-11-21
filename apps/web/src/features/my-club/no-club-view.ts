// My Club for a member without a club, on the club popup's card (club-card.ts): the member's invitations (also
// shown here when Discord DMs are closed), creating a club (the same form as the settings, club-edit.ts, or why
// it is not possible yet) and the open clubs to join at once (from the public club list).

import { escapeHtml } from "@ms/shared/html";
import { toText } from "@ms/shared/text";
import type { Club } from "../clubs/club-data.ts";
import { regionBadgeHtml } from "../clubs/club-profile-view.ts";
import {
  createClubCard,
  dateText,
  dateTimeText,
  lineButton,
  lineTextHtml,
  noteHtml,
  rowHtml,
  sectionHtml,
} from "./club-card.ts";
import { createClubEditor, type SubmitResult } from "./club-edit.ts";
import { MY_CLUB_URL, clubRequest, type MyClubState } from "./my-club-data.ts";
import type { MyClubContext, MyClubView } from "./my-club-page.ts";
import type { ClubSettingsValue } from "@ms/shared/clubs";

interface OpenClub extends Club {
  readonly club_id?: number;
  readonly is_open?: boolean;
}

const NO_SETTINGS: ClubSettingsValue = {
  isOpen: false,
  regions: [],
  clubCodes: [],
  firstUniform: "",
  secondUniform: "",
  stadium: "",
  discordUrl: "",
};

export function createNoClubView(context: MyClubContext, initial: MyClubState): MyClubView {
  const card = createClubCard();
  let state = initial;
  let creating = false;
  let openClubs: readonly OpenClub[] | null = null;
  let busy = false;

  card.view.setText("club-name", "My Club");
  card.content.insertAdjacentHTML(
    "beforeend",
    [
      '<div class="profile-top-line my-club-top-line"><p class="profile-club-line">You are not in a club yet.</p></div>',
      '<div data-my-club="invitations"></div>',
      '<div data-my-club="create"></div>',
      '<div data-my-club="open-clubs"></div>',
    ].join(""),
  );
  const part = (key: string): HTMLElement => {
    const node = card.content.querySelector<HTMLElement>(`[data-my-club="${key}"]`);
    if (!node) throw new Error(`Missing part ${key}.`);
    return node;
  };

  function drawInvitations(): void {
    if (!state.invitations.length) {
      part("invitations").innerHTML = "";
      return;
    }
    const rows = state.invitations
      .map((invitation) =>
        rowHtml(
          [
            lineTextHtml(
              `${invitation.club_name} [${invitation.club_tag}]`,
              `Invited by ${invitation.invited_by} · open until ${dateText(invitation.expires_at)}`,
            ),
            '<span class="my-club-line-actions">',
            lineButton("accept", "Accept", `data-invitation="${String(invitation.id)}"`, "primary"),
            lineButton("decline", "Decline", `data-invitation="${String(invitation.id)}"`),
            "</span>",
          ].join(""),
        ),
      )
      .join("");
    part("invitations").innerHTML = sectionHtml(
      "invitations",
      "Invitations",
      `<div class="player-popup-code-list">${rows}</div>`,
    );
  }

  async function submitNewClub(request: Record<string, unknown>): Promise<SubmitResult> {
    const response = await context.act("POST", `${MY_CLUB_URL}/create`, request, {
      success: "Your club was created.",
      own: ["VALIDATION_FAILED"],
    });
    if (response.ok) return { kind: "done" };
    if (response.error.code === "VALIDATION_FAILED") return { kind: "fields", fields: response.error.fields ?? [] };
    return { kind: "failed" };
  }

  function drawCreate(): void {
    const mount = part("create");
    if (creating && state.create.allowed) {
      mount.innerHTML = sectionHtml(
        "create",
        "Create a Club",
        '<p class="profile-row-hint">You become its captain. The name and the tag cannot be changed later.</p><div data-my-club="create-form"></div>',
      );
      const form = mount.querySelector<HTMLElement>('[data-my-club="create-form"]');
      if (form) {
        createClubEditor({
          root: card.root,
          mount: form,
          mode: "create",
          saved: NO_SETTINGS,
          version: "",
          editable: true,
          submit: submitNewClub,
          cancel: () => {
            creating = false;
            drawCreate();
          },
        });
        form.querySelector<HTMLElement>("input")?.focus();
      }
      return;
    }
    const inner = state.create.allowed
      ? rowHtml(
          `${lineTextHtml("Start a club of your own.")}<span class="my-club-line-actions">${lineButton("create", "Create a Club", "", "primary")}</span>`,
        )
      : rowHtml(
          lineTextHtml(state.create.reason?.error ?? "You cannot create a club right now."),
          " profile-code-missing",
        );
    mount.innerHTML = sectionHtml("create", "Create a Club", `<div class="player-popup-code-list">${inner}</div>`);
  }

  function blockedUntil(clubId: number): string | null {
    const blocks = state.join_blocks.filter((block) => block.club_id === clubId).map((block) => block.until);
    return blocks.sort().at(-1) ?? null;
  }

  function drawOpenClubs(): void {
    const mount = part("open-clubs");
    const cooldown = state.join_cooldown_until && Date.parse(state.join_cooldown_until) > Date.now();
    const note = cooldown
      ? `<p class="profile-row-hint">You can join a club by yourself again from ${escapeHtml(dateTimeText(state.join_cooldown_until))}. An invitation can be accepted at once.</p>`
      : "";
    if (!openClubs) {
      mount.innerHTML = sectionHtml(
        "open-clubs",
        "Open Clubs",
        `${note}<p class="profile-row-hint">Loading clubs…</p>`,
      );
      return;
    }
    const rows = openClubs
      .map((club) => {
        const id = Number(club.club_id);
        const until = blockedUntil(id);
        const count = Number(club.member_count);
        const members = Number.isInteger(count) && count > 0 ? `${String(count)} member${count === 1 ? "" : "s"}` : "";
        const regions = Array.isArray(club.regions) ? (club.regions as unknown[]).map((region) => toText(region)) : [];
        const action = until
          ? noteHtml("Rejoin from", dateText(until))
          : lineButton("join", "Join", `data-club="${String(id)}"${cooldown ? " disabled" : ""}`);
        return [
          '<li class="club-popup-roster-item my-club-open-club">',
          '<span class="club-popup-roster-player">',
          `<span class="club-popup-roster-name">${escapeHtml(`${toText(club.name)} [${toText(club.tag)}]`)}</span>`,
          // Under the name: its regions and its size.
          `<span class="my-club-open-club-detail"><span class="club-edit-badges">${regions.map(regionBadgeHtml).join("")}</span>`,
          members ? `<span class="club-popup-roster-discord-name">${escapeHtml(members)}</span>` : "",
          "</span>",
          "</span>",
          `<span class="my-club-line-actions">${action}</span>`,
          "</li>",
        ].join("");
      })
      .join("");
    mount.innerHTML = sectionHtml(
      "open-clubs",
      "Open Clubs",
      rows
        ? `${note}<ul class="club-popup-roster my-club-roster is-clubs">${rows}</ul>`
        : `${note}<div class="player-popup-code-list">${rowHtml('<span class="player-popup-code-value">No club is open to anyone right now.</span>', " profile-code-missing")}</div>`,
    );
  }

  async function loadOpenClubs(): Promise<void> {
    const response = await clubRequest<{ rows?: readonly OpenClub[] }>("GET", "/api/clubs/msbl");
    openClubs = (response.body?.rows ?? []).filter((club) => club.is_open === true && Number(club.club_id) > 0);
    drawOpenClubs();
  }

  async function run(method: "POST", path: string, body: unknown, success: string): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await context.act(method, path, body, { success });
    } finally {
      busy = false;
    }
  }

  card.root.addEventListener("click", (event) => {
    const element = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-club-action]") : null;
    if (!element || (element instanceof HTMLButtonElement && element.disabled)) return;
    const invitation = element.dataset.invitation ?? "";
    switch (element.dataset.clubAction) {
      case "accept":
        void run("POST", `${MY_CLUB_URL}/invitations/${invitation}/accept`, undefined, "Welcome to your new club.");
        break;
      case "decline":
        void run("POST", `${MY_CLUB_URL}/invitations/${invitation}/decline`, undefined, "Invitation declined.");
        break;
      case "create":
        creating = true;
        drawCreate();
        break;
      case "join":
        void run(
          "POST",
          `${MY_CLUB_URL}/join`,
          { club_id: Number(element.dataset.club ?? 0) },
          "Welcome to your new club.",
        );
        break;
    }
  });

  drawInvitations();
  drawCreate();
  drawOpenClubs();
  void loadOpenClubs();

  return {
    root: card.root,
    clubId: null,
    update(next) {
      state = next;
      drawInvitations();
      if (!creating) drawCreate();
      drawOpenClubs();
    },
  };
}
