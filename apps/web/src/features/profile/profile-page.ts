// The signed-in player's own profile (/profile), from /api/profile/me, or the reason it cannot be shown.

import { escapeHtml } from "@ms/shared/html";
import { flagTitleAttribute, flagUrl, normalizeCountryCode } from "../../lib/countries.ts";
import {
  accoladeNameClasses,
  dateText,
  gameBallIconUrl,
  hasDisplayText,
  mscFriendCodeLines,
  parseCodeLine,
  switchFriendCodeLines,
  text,
  type Accolade,
  type FriendCodes,
  type PlayerProfile,
  type SeasonAward,
} from "../players/profile-data.ts";
import { buildDoubles, buildSingles, type Ratings } from "../rating-cards/rating-cards.ts";

const DISCORD_ACTION =
  '<p class="profile-state-actions"><a class="profile-action-button" href="https://discord.gg/de2YaWg" target="_blank" rel="noopener noreferrer">Open Discord</a></p>';

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
  return `<img class="${className}" src="${escapeHtml(icon)}" alt="" aria-hidden="true" loading="lazy" onerror="this.onerror=null;this.src='${escapeHtml(fallback)}'">`;
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
        `<span class="profile-season-award-season">${escapeHtml(text(entry.season_name))}</span>`,
        ballImage("profile-season-award-ball", entry.game_code),
        `<span class="profile-season-award-name">${escapeHtml(text(entry.award_name || "-"))}</span>`,
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
        `<span class="profile-accolade-medal${entry.is_world_champion ? " is-world-champion" : ""}">${escapeHtml(text(entry.place_medal))}</span>`,
        `<span class="${escapeHtml(accoladeNameClasses("profile-accolade-name", entry))}">${escapeHtml(text(entry.tournament_name || "-"))}</span>`,
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
    ? `<img class="profile-header-flag" src="${escapeHtml(flagUrl(countryCode))}" alt="" aria-hidden="true"${flagTitleAttribute(countryCode)} onerror="this.remove();">`
    : "";
  const clubName = text(player.club_name).trim();
  const clubText = clubName
    ? clubName + (player.club_tag ? ` [${text(player.club_tag)}]` : "")
    : "No club membership listed.";
  const resultsUrl = text(player.results_url).trim();
  const results = resultsUrl
    ? `<section class="profile-panel profile-results-panel"><p class="profile-meta-line profile-results-line"><a href="${escapeHtml(resultsUrl)}" target="_blank" rel="noopener noreferrer">Results at start.gg</a></p></section>`
    : "";
  return [
    '<section class="profile-shell">',
    '<header class="profile-header-panel">',
    '<div class="profile-header-title">',
    `<h2 class="profile-name">${escapeHtml(text(player.name || "Player Profile"))}</h2>`,
    flag,
    "</div>",
    '<div class="profile-meta">',
    `<p class="profile-meta-line"><span>Club</span><strong>${escapeHtml(clubText)}</strong></p>`,
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

function authErrorHtml(payload: { code?: unknown } | null, status: number): string {
  if (status === 401) {
    return statePanel(
      "Login Required",
      "Login with Discord to open your linked player profile.",
      '<p class="profile-state-actions"><a class="profile-action-button" href="/api/auth/discord/start?returnTo=%2Fprofile">Login with Discord</a></p>',
    );
  }
  if (payload?.code === "PLAYER_PROFILE_NOT_LINKED") {
    return statePanel(
      "No Linked Player Profile",
      "Your Discord login is valid, but no player profile is linked to this Discord account yet. Contact staff on Discord to link it.",
      DISCORD_ACTION,
    );
  }
  if (payload?.code === "PLAYER_PROFILE_CONFLICT") {
    return statePanel(
      "Profile Link Conflict",
      "More than one player profile matches this Discord account. Contact staff on Discord so the duplicate link can be fixed.",
      DISCORD_ACTION,
    );
  }
  return statePanel("Profile Unavailable", "The profile could not be loaded right now. Please try again later.");
}

/** The login flow returns with ?auth=<result>; the address bar drops it once the profile shows. */
function removeAuthQuery(): void {
  if (!window.location.search) return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("auth")) return;
  params.delete("auth");
  const query = params.toString();
  window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : "") + window.location.hash);
}

export async function initProfilePage(mount: HTMLElement): Promise<void> {
  mount.innerHTML = '<p class="profile-loading loading-note">Loading...</p>';
  try {
    const response = await fetch("/api/profile/me", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const payload = (await response.json().catch(() => ({}))) as { code?: unknown; profile?: PlayerProfile } | null;
    if (!response.ok) {
      mount.innerHTML = authErrorHtml(payload, response.status);
      return;
    }
    mount.innerHTML = profileHtml(payload?.profile ?? {});
    removeAuthQuery();
  } catch {
    mount.innerHTML = authErrorHtml(null, 500);
  }
}
