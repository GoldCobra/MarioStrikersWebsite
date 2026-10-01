// The signed-in player's own profile (/profile), from /api/profile/me, or the reason it cannot be shown.
// The login creates a missing profile; when that failed, the page asks for it once more. "Edit Profile"
// (or ?edit=1, the account menu's "Modify Profile") opens the editor (profile-edit.ts).

import { toText } from "@ms/shared/text";
import { escapeHtml } from "@ms/shared/html";
import { flagTitleAttribute, flagUrl, normalizeCountryCode } from "../../lib/countries.ts";
import {
  accoladeNameClasses,
  dateText,
  gameBallIconUrl,
  hasDisplayText,
  isWorldChampion,
  mscFriendCodeLines,
  parseCodeLine,
  switchFriendCodeLines,
  type Accolade,
  type FriendCodes,
  type PlayerProfile,
  type SeasonAward,
} from "../players/profile-data.ts";
import { buildDoubles, buildSingles, type Ratings } from "../rating-cards/rating-cards.ts";
import { openProfileEditor } from "./profile-edit.ts";

const DISCORD_LINK =
  '<a class="profile-action-button" href="https://discord.gg/de2YaWg" target="_blank" rel="noopener noreferrer">Open Discord</a>';
const LOGIN_LINK =
  '<a class="profile-action-button" href="/api/auth/discord/start?returnTo=%2Fprofile">Login with Discord</a>';
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

function codeSection(title: string, values: readonly unknown[]): string {
  const rows = values.filter(hasDisplayText);
  if (!rows.length) return "";
  const lines = rows
    .map((line) => {
      const { prefix, code } = parseCodeLine(line);
      const prefixHtml = prefix ? `<span class="profile-code-prefix">${escapeHtml(prefix)}</span>` : "";
      return `<div class="profile-code-row">${prefixHtml}<span class="profile-code-value">${escapeHtml(code)}</span></div>`;
    })
    .join("");
  return [
    '<section class="profile-panel profile-code-panel">',
    `<h3 class="profile-panel-title">${escapeHtml(title)}</h3>`,
    `<div class="profile-code-list">${lines}</div>`,
    "</section>",
  ].join("");
}

function friendCodes(data: FriendCodes): string {
  const sections = [
    codeSection("Switch Friend Code", switchFriendCodeLines(data)),
    codeSection("MSC Friend Codes", mscFriendCodeLines(data)),
  ].filter(Boolean);
  if (sections.length) return sections.join("");
  return [
    '<section class="profile-panel">',
    '<h3 class="profile-panel-title">Friend Codes</h3>',
    '<p class="profile-muted">No friend codes are listed for this profile.</p>',
    "</section>",
  ].join("");
}

function ratingsPanel(ratings: Ratings): string {
  const singles = buildSingles(ratings, "profile");
  const doubles = buildDoubles(ratings, "profile");
  if (!singles && !doubles) return "";
  return [
    '<section class="profile-panel profile-ratings-panel">',
    '<h3 class="profile-panel-title">Ratings</h3>',
    singles ? `<div class="profile-ratings-grid">${singles}</div>` : "",
    doubles ? `<div class="profile-ratings-grid">${doubles}</div>` : "",
    "</section>",
  ].join("");
}

function ballImage(className: string, gameCode: unknown): string {
  const icon = gameBallIconUrl(gameCode);
  const fallback = icon.replace(/\.webp$/i, ".png");
  return `<img class="${className}" src="${escapeHtml(icon)}" alt="" aria-hidden="true" loading="lazy" data-fallback-src="${escapeHtml(fallback)}">`;
}

function collapsedPanel(kind: "season-awards" | "accolades", title: string, items: string): string {
  return [
    `<section class="profile-panel profile-${kind}-panel">`,
    `<details class="profile-${kind}-details">`,
    `<summary class="profile-${kind}-summary"><span class="profile-panel-title">${title}</span></summary>`,
    `<ul class="profile-${kind}">${items}</ul>`,
    "</details>",
    "</section>",
  ].join("");
}

function seasonAwards(awards: readonly SeasonAward[]): string {
  if (!awards.length) return "";
  const items = awards
    .map((entry) =>
      [
        '<li class="profile-season-award-item">',
        `<span class="profile-season-award-season">${escapeHtml(toText(entry.season_name))}</span>`,
        ballImage("profile-season-award-ball", entry.game_code),
        `<span class="profile-season-award-name">${escapeHtml(toText(entry.award_name || "-"))}</span>`,
        "</li>",
      ].join(""),
    )
    .join("");
  return collapsedPanel("season-awards", "Season Rewards", items);
}

function accolades(entries: readonly Accolade[]): string {
  if (!entries.length) return "";
  const items = entries
    .map((entry) => {
      const date = dateText(entry.start_date);
      return [
        '<li class="profile-accolade-item">',
        ballImage("profile-accolade-ball", entry.game_code),
        `<span class="profile-accolade-medal${entry.is_world_champion ? " is-world-champion" : ""}">${escapeHtml(toText(entry.place_medal))}</span>`,
        `<span class="${escapeHtml(accoladeNameClasses("profile-accolade-name", entry))}">${escapeHtml(toText(entry.tournament_name || "-"))}</span>`,
        date ? `<span class="profile-accolade-date">${escapeHtml(date)}</span>` : "",
        "</li>",
      ].join("");
    })
    .join("");
  return collapsedPanel("accolades", "Tourney Accolades", items);
}

function profileHtml(profile: PlayerProfile): string {
  const player = profile.player ?? {};
  const countryCode = normalizeCountryCode(player.country);
  const flag = countryCode
    ? `<img class="profile-header-flag" src="${escapeHtml(flagUrl(countryCode))}" alt="" aria-hidden="true"${flagTitleAttribute(countryCode)} data-on-error="remove">`
    : "";
  const clubName = toText(player.club_name).trim();
  const clubText = clubName
    ? clubName + (player.club_tag ? ` [${toText(player.club_tag)}]` : "")
    : "No club membership listed.";
  const resultsUrl = toText(player.results_url).trim();
  const results = resultsUrl
    ? `<section class="profile-panel profile-results-panel"><p class="profile-meta-line profile-results-line"><a href="${escapeHtml(resultsUrl)}" target="_blank" rel="noopener noreferrer">Results at start.gg</a></p></section>`
    : "";
  // An MSL World Champion's header turns gold and shows the MSL logo at its right end.
  const champion = isWorldChampion(profile.accolades);
  return [
    '<section class="profile-shell">',
    '<header class="profile-header-panel">',
    `<div class="profile-header-title${champion ? " is-world-champion" : ""}">`,
    `<h2 class="profile-name">${escapeHtml(toText(player.name || "Player Profile"))}</h2>`,
    flag,
    champion
      ? '<span class="profile-msl-champion" role="img" aria-label="MSL World Champion" title="MSL World Champion"></span>'
      : "",
    "</div>",
    '<div class="profile-meta">',
    `<p class="profile-meta-line"><span>Club</span><strong>${escapeHtml(clubText)}</strong></p>`,
    '<p class="profile-meta-actions"><button class="profile-action-button" type="button" data-profile-action="edit">Edit Profile</button></p>',
    "</div>",
    "</header>",
    '<div class="profile-grid">',
    '<div class="profile-grid-main">',
    friendCodes(profile.friend_codes ?? {}),
    seasonAwards(profile.season_awards ?? []),
    accolades(profile.accolades ?? []),
    results,
    "</div>",
    `<div class="profile-grid-side">${ratingsPanel(profile.ratings ?? {})}</div>`,
    "</div>",
    "</section>",
  ].join("");
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

/**
 * The login flow returns with ?auth=<result> and the account menu opens the editor with ?edit=1; the
 * address bar drops both once the profile shows.
 */
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

/** Shows the profile; true when it is shown. A quiet load (after a save) keeps the old view meanwhile. */
async function loadProfile(mount: HTMLElement, quiet = false): Promise<boolean> {
  if (!quiet) mount.innerHTML = '<p class="profile-loading loading-note">Loading...</p>';
  try {
    let result = await fetchProfile();
    if (result.payload?.code === "PLAYER_PROFILE_NOT_LINKED" && (await createProfile())) result = await fetchProfile();
    if (result.status !== 200) {
      if (!quiet) mount.innerHTML = authErrorHtml(result.payload, result.status);
      return false;
    }
    mount.innerHTML = profileHtml(result.payload?.profile ?? {});
    removeProfileQuery();
    return true;
  } catch {
    if (!quiet) mount.innerHTML = authErrorHtml(null, 500);
    return false;
  }
}

function openEditor(mount: HTMLElement, opener: HTMLElement | null): void {
  void openProfileEditor(opener, () => void loadProfile(mount, true));
}

export async function initProfilePage(mount: HTMLElement): Promise<void> {
  mount.addEventListener("click", (event) => {
    const action = event.target instanceof Element ? event.target.closest("[data-profile-action]") : null;
    if (!action || !mount.contains(action)) return;
    const name = action.getAttribute("data-profile-action");
    if (name === "retry") void loadProfile(mount);
    else if (name === "edit") openEditor(mount, action instanceof HTMLElement ? action : null);
  });
  const openOnLoad = new URLSearchParams(window.location.search).get("edit") === "1";
  if (!(await loadProfile(mount))) return;
  if (openOnLoad) openEditor(mount, mount.querySelector<HTMLElement>("[data-profile-action='edit']"));
}
