// The signed-in player's own profile (/profile), from /api/profile/me, or the reason it cannot be shown.
// It is formatted exactly like the player popup (the same template, renderer and styles; the page itself
// is no popup) and edited in place (profile-edit.ts). The login creates a missing profile; when that
// failed, the page asks for it once more.

import { toText } from "@ms/shared/text";
import { escapeHtml } from "@ms/shared/html";
import { loginPath } from "@ms/shared/site/navigation";
import { templateView, type TemplateView } from "../../lib/popup.ts";
import { renderPlayerProfile } from "../players/player-profile-view.ts";
import type { PlayerProfile } from "../players/profile-data.ts";
import template from "../players/player-profile-popup.html?raw";
import { createProfileEditor } from "./profile-edit.ts";
import type { EditableProfile } from "./profile-edit-state.ts";

const DISCORD_LINK =
  '<a class="profile-action-button" href="https://discord.gg/de2YaWg" target="_blank" rel="noopener noreferrer">Open Discord</a>';
const LOGIN_LINK = `<a class="profile-action-button" href="${loginPath()}">Login with Discord</a>`;
const RETRY_BUTTON =
  '<button class="profile-action-button" type="button" data-profile-action="retry">Try again</button>';

function actions(...buttons: string[]): string {
  return `<p class="profile-state-actions">${buttons.join(" ")}</p>`;
}

function statePanel(title: string, message: string, actionHtml = ""): string {
  return [
    '<section class="profile-state-panel">',
    `<h2 class="profile-state-title">${escapeHtml(title)}</h2>`,
    `<p class="profile-state-message">${escapeHtml(message)}</p>`,
    actionHtml,
    "</section>",
  ].join("");
}

interface ProfileCard {
  readonly root: HTMLElement;
  readonly view: TemplateView;
}

/**
 * The player popup's card as a section of the page: the same markup, so the same styles apply
 * (#player-profile-page next to #player-profile-popup), without what makes the popup a popup: no
 * overlay, no close button, no dialog role, no loading line.
 */
function createProfileCard(): ProfileCard {
  const host = document.createElement("div");
  host.innerHTML = template.trim();
  const card = host.querySelector<HTMLElement>(".player-popup-card");
  if (!card) throw new Error("Invalid profile template.");
  card.removeAttribute("role");
  card.removeAttribute("aria-modal");
  card.querySelector(".player-popup-close")?.remove();
  card.querySelector("[data-slot='popup-status']")?.remove();
  card.querySelector("[data-slot='popup-content']")?.removeAttribute("hidden");
  const root = document.createElement("div");
  root.id = "player-profile-page";
  root.append(card);
  return { root, view: templateView(root) };
}

/** "Member of <club> [<tag>]" as the first line; without a club the line stays, empty. */
function renderClubLine(card: ProfileCard, player: PlayerProfile["player"]): void {
  const content = card.root.querySelector(".player-popup-content");
  if (!content) return;
  let line = content.querySelector<HTMLElement>(":scope > .profile-club-line");
  if (!line) {
    line = document.createElement("p");
    line.className = "profile-club-line";
    content.prepend(line);
  }
  const name = toText(player?.club_name).trim();
  const tag = toText(player?.club_tag).trim();
  line.innerHTML = name
    ? `Member of <span class="profile-club-name">${escapeHtml(tag ? `${name} [${tag}]` : name)}</span>`
    : "";
}

function renderCard(card: ProfileCard, profile: PlayerProfile): void {
  renderPlayerProfile(card.view, profile);
  renderClubLine(card, profile.player);
}

/** The result of the login flow, which returns with ?auth=<result>. */
function authResult(): string {
  return new URLSearchParams(window.location.search).get("auth") ?? "";
}

function loginRequiredHtml(): string {
  switch (authResult()) {
    case "not_member":
      return statePanel(
        "Discord Server Required",
        "Only members of the Mario Strikers Discord server can log in. Join the server, then log in again.",
        actions(DISCORD_LINK, LOGIN_LINK),
      );
    case "failed":
      return statePanel("Login Failed", "The Discord login did not complete. Please try again.", actions(LOGIN_LINK));
    case "unavailable":
      return statePanel("Login Unavailable", "Login with Discord is not available right now. Please try again later.");
    default:
      return statePanel("Login Required", "Login with Discord to open your player profile.", actions(LOGIN_LINK));
  }
}

function authErrorHtml(payload: { code?: unknown } | null, status: number): string {
  if (status === 401) return loginRequiredHtml();
  if (payload?.code === "PLAYER_PROFILE_NOT_LINKED") {
    return statePanel(
      "Profile Not Ready",
      "Your player profile could not be set up right now. Please try again in a moment.",
      actions(RETRY_BUTTON),
    );
  }
  if (payload?.code === "PLAYER_PROFILE_CONFLICT") {
    return statePanel(
      "Profile Link Conflict",
      "More than one player profile matches this Discord account. Contact staff on Discord so the duplicate link can be fixed.",
      actions(DISCORD_LINK),
    );
  }
  return statePanel(
    "Profile Unavailable",
    "The profile could not be loaded right now. Please try again later.",
    actions(RETRY_BUTTON),
  );
}

/** The login flow returns with ?auth=<result>; the address bar drops it (and an old ?edit=1) once the profile shows. */
function removeProfileQuery(): void {
  if (!window.location.search) return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("auth") && !params.has("edit")) return;
  params.delete("auth");
  params.delete("edit");
  const query = params.toString();
  window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : "") + window.location.hash);
}

interface ProfileResponse {
  readonly status: number;
  readonly payload: { code?: unknown; profile?: PlayerProfile } | null;
}

async function fetchProfile(): Promise<ProfileResponse> {
  const response = await fetch("/api/profile/me", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json().catch(() => ({}))) as ProfileResponse["payload"];
  return { status: response.status, payload };
}

/** Creates the profile the login could not create; true once it exists. */
async function createProfile(): Promise<boolean> {
  try {
    const response = await fetch("/api/profile/me", {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function fetchEditable(): Promise<EditableProfile | null> {
  try {
    const response = await fetch("/api/profile/me/editable", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    return response.ok ? ((await response.json()) as EditableProfile) : null;
  } catch {
    return null;
  }
}

/** Shows the profile and its editing. */
async function loadProfile(mount: HTMLElement): Promise<void> {
  mount.innerHTML = '<p class="profile-loading loading-note">Loading...</p>';
  try {
    let result = await fetchProfile();
    if (result.payload?.code === "PLAYER_PROFILE_NOT_LINKED" && (await createProfile())) result = await fetchProfile();
    if (result.status !== 200) {
      mount.innerHTML = authErrorHtml(result.payload, result.status);
      return;
    }
    const card = createProfileCard();
    renderCard(card, result.payload?.profile ?? {});
    mount.replaceChildren(card.root);
    removeProfileQuery();
    const editable = await fetchEditable();
    if (!editable) {
      card.root
        .querySelector(".player-popup-content")
        ?.insertAdjacentHTML(
          "afterbegin",
          '<p class="profile-edit-status">Your profile cannot be changed right now. Please try again later.</p>',
        );
      return;
    }
    createProfileEditor({
      root: card.root,
      profile: editable,
      reload: async () => {
        const next = await fetchProfile();
        if (next.status === 200) renderCard(card, next.payload?.profile ?? {});
      },
    });
  } catch {
    mount.innerHTML = authErrorHtml(null, 500);
  }
}

export async function initProfilePage(mount: HTMLElement): Promise<void> {
  mount.addEventListener("click", (event) => {
    const action = event.target instanceof Element ? event.target.closest("[data-profile-action]") : null;
    if (action && mount.contains(action) && action.getAttribute("data-profile-action") === "retry") {
      void loadProfile(mount);
    }
  });
  await loadProfile(mount);
}
