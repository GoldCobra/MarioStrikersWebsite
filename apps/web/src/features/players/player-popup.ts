// The player profile popup of the players list and the leaderboards, filled from
// /api/players/:id/profile.

import { toPositiveInt, toText } from "@ms/shared/text";
import { escapeHtml } from "@ms/shared/html";
import { fetchJson } from "../../lib/api.ts";
import { countryDisplayName, flagUrl, normalizeCountryCode } from "../../lib/countries.ts";
import { TemplatePopup } from "../../lib/popup.ts";
import { buildDoubles, buildSingles } from "../rating-cards/rating-cards.ts";
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
  type PlayerProfile,
  type SeasonAward,
} from "./profile-data.ts";
import template from "./player-profile-popup.html?raw";

const popup = new TemplatePopup({
  template,
  openClass: "player-popup-open",
  closeButtonSelector: ".player-popup-close",
});

function setSectionHidden(node: HTMLElement | undefined, hidden: boolean): void {
  const section = node?.closest<HTMLElement>(".player-popup-section");
  if (section) section.hidden = hidden;
}

function renderCodeLines(listKey: string, values: readonly unknown[]): void {
  const mount = popup.lists[listKey];
  if (!mount) return;
  const rows = values.filter(hasDisplayText);
  if (!rows.length) {
    mount.innerHTML = "";
    setSectionHidden(mount, true);
    return;
  }
  setSectionHidden(mount, false);
  mount.innerHTML = rows
    .map((line) => {
      const { prefix, code } = parseCodeLine(line);
      const prefixHtml = prefix ? `<span class="player-popup-code-prefix">${escapeHtml(prefix)}</span>` : "";
      return `<div class="player-popup-code-row">${prefixHtml}<span class="player-popup-code-value">${escapeHtml(code)}</span></div>`;
    })
    .join("");
}

function ballImage(className: string, gameCode: unknown): string {
  const icon = gameBallIconUrl(gameCode);
  const fallback = icon.replace(/\.webp$/i, ".png");
  return `<img class="${className}" src="${escapeHtml(icon)}" alt="" aria-hidden="true" loading="lazy" data-fallback-src="${escapeHtml(fallback)}">`;
}

/** Collapsed list inside a <details>: hidden when empty, closed on every new profile. */
function renderDetailsList<T>(
  listKey: string,
  detailsClass: string,
  entries: readonly T[],
  item: (entry: T) => string,
): void {
  const mount = popup.lists[listKey];
  if (!mount) return;
  const details = mount.closest<HTMLDetailsElement>(detailsClass);
  if (details) details.open = false;
  if (!entries.length) {
    mount.innerHTML = "";
    setSectionHidden(mount, true);
    return;
  }
  setSectionHidden(mount, false);
  mount.innerHTML = entries.map(item).join("");
}

function seasonAwardItem(entry: SeasonAward | null | undefined): string {
  const season = toText(entry?.season_name).trim();
  const award = toText(entry?.award_name).trim() || "-";
  return [
    '<li class="player-popup-season-award-item">',
    `<span class="player-popup-season-award-season">${escapeHtml(season)}</span>`,
    ballImage("player-popup-season-award-ball", entry?.game_code),
    `<span class="player-popup-season-award-name">${escapeHtml(award)}</span>`,
    "</li>",
  ].join("");
}

function accoladeItem(entry: Accolade | null | undefined): string {
  const medal = toText(entry?.place_medal || "•").trim() || "•";
  const name = toText(entry?.tournament_name).trim() || "-";
  const date = dateText(entry?.start_date);
  return [
    '<li class="player-popup-accolade-item">',
    ballImage("player-popup-accolade-ball", entry?.game_code),
    `<span class="player-popup-accolade-medal${entry?.is_world_champion ? " is-world-champion" : ""}">${escapeHtml(medal)}</span>`,
    `<span class="${escapeHtml(accoladeNameClasses("player-popup-accolade-name", entry))}">${escapeHtml(name)}</span>`,
    date ? `<span class="player-popup-accolade-date">${escapeHtml(date)}</span>` : "",
    "</li>",
  ].join("");
}

function renderFlag(country: unknown): void {
  const flag = popup.slots["player-flag"] as HTMLImageElement | undefined;
  if (!flag) return;
  const code = normalizeCountryCode(country);
  if (code) {
    const name = countryDisplayName(code);
    flag.src = flagUrl(code);
    if (name) flag.title = name;
    else flag.removeAttribute("title");
    flag.hidden = false;
  } else {
    flag.hidden = true;
    flag.removeAttribute("src");
    flag.removeAttribute("title");
  }
}

/** An MSL World Champion's header turns gold and shows the MSL logo left of the close button. */
function renderWorldChampion(champion: boolean): void {
  popup.slots["player-header"]?.classList.toggle("is-world-champion", champion);
  const logo = popup.slots["player-msl-champion"];
  if (logo) logo.hidden = !champion;
}

function renderResultsLink(url: string): void {
  const section = popup.slots["results-section"];
  const link = popup.slots["results-link"] as HTMLAnchorElement | undefined;
  if (!section || !link) return;
  if (url) {
    link.href = url;
    link.textContent = "Results at start.gg";
    section.hidden = false;
  } else {
    section.hidden = true;
    link.removeAttribute("href");
    link.textContent = "";
  }
}

function renderRatings(profile: PlayerProfile): void {
  const ratings = profile.ratings ?? {};
  const singlesMount = popup.slots["ratings-grid-singles"];
  const doublesMount = popup.slots["ratings-grid-doubles"];
  let singles = "";
  let doubles = "";
  if (singlesMount) {
    singles = buildSingles(ratings, "player-popup");
    singlesMount.innerHTML = singles;
    singlesMount.hidden = !singles;
  }
  if (doublesMount) {
    doubles = buildDoubles(ratings, "player-popup");
    doublesMount.innerHTML = doubles;
    doublesMount.hidden = !doubles;
  }
  if (singlesMount ?? doublesMount) setSectionHidden(singlesMount ?? doublesMount, !singles && !doubles);
}

function renderProfile(profile: PlayerProfile): void {
  const player = profile.player ?? {};
  const friendCodes = profile.friend_codes ?? {};
  popup.setText("player-name", toText(player.name || "-"));
  renderFlag(player.country);
  renderWorldChampion(isWorldChampion(profile.accolades));
  renderCodeLines("fc-switch", switchFriendCodeLines(friendCodes));
  renderCodeLines("fc-msc", mscFriendCodeLines(friendCodes));
  renderResultsLink(toText(player.results_url).trim());
  renderDetailsList(
    "season-awards",
    ".player-popup-season-awards-details",
    profile.season_awards ?? [],
    seasonAwardItem,
  );
  renderDetailsList("accolades", ".player-popup-accolades-details", profile.accolades ?? [], accoladeItem);
  renderRatings(profile);

  const bannerSection = popup.slots["rank-banner-section"];
  const banner = popup.slots["rank-banner"];
  if (bannerSection && banner) {
    banner.removeAttribute("src");
    bannerSection.hidden = true;
  }
}

// A profile takes about half a second to arrive, so each one is asked for once and kept for a few
// minutes: hovering a name starts the request, and reopening a profile is instant.
const PROFILE_CACHE_MS = 5 * 60_000;
const profileRequests = new Map<number, { readonly at: number; readonly profile: Promise<PlayerProfile | null> }>();

function loadProfile(playerId: number): Promise<PlayerProfile | null> {
  const cached = profileRequests.get(playerId);
  if (cached && Date.now() - cached.at < PROFILE_CACHE_MS) return cached.profile;
  const profile = fetchJson<PlayerProfile | null>(`/api/players/${encodeURIComponent(String(playerId))}/profile`);
  profileRequests.set(playerId, { at: Date.now(), profile });
  // A failed request is not kept, so the next attempt asks again.
  profile.catch(() => {
    if (profileRequests.get(playerId)?.profile === profile) profileRequests.delete(playerId);
  });
  return profile;
}

function prefetchProfile(playerId: number): void {
  loadProfile(playerId).catch(() => undefined);
}

// The name that was clicked shows that its profile is loading (aria-busy, player-popup.css).
let busyTrigger: HTMLElement | null = null;

function markBusy(trigger: HTMLElement | null): void {
  busyTrigger?.removeAttribute("aria-busy");
  busyTrigger = trigger;
  busyTrigger?.setAttribute("aria-busy", "true");
}

function clearHeader(): void {
  popup.setText("player-name", "");
  renderFlag(null);
  renderWorldChampion(false);
}

/**
 * Opens the popup once the profile is there, so it never shows half empty; until then the clicked
 * name shows that it is loading. Escape or another name cancels it.
 */
export async function openPlayerPopup(playerId: number, opener: HTMLElement | null): Promise<void> {
  if (!toPositiveInt(playerId)) return;
  const request = popup.begin();
  markBusy(opener);
  let profile: PlayerProfile | null = null;
  let failed = false;
  try {
    profile = await loadProfile(playerId);
  } catch {
    failed = true;
  }
  if (busyTrigger === opener) markBusy(null);
  if (!popup.isCurrent(request)) return;
  popup.ensure();
  if (failed) {
    clearHeader();
    popup.showStatus("Failed to load player profile.", true);
  } else {
    renderProfile(profile ?? {});
    popup.showStatus(null);
  }
  popup.open(opener);
}

let triggersBound = false;

function playerTrigger(target: EventTarget | null): HTMLElement | null {
  const trigger = target instanceof Element ? target.closest(".players-name-trigger, .lb-player-trigger") : null;
  return trigger instanceof HTMLElement ? trigger : null;
}

function triggerPlayerId(trigger: HTMLElement | null): number | null {
  return trigger ? toPositiveInt(trigger.getAttribute("data-player-id")) : null;
}

/**
 * Player names in the players list and the leaderboards open the popup. Resting the pointer or focus
 * on a name for a moment (not sweeping over the list) or pressing it starts loading its profile.
 */
export function bindPlayerProfileTriggers(): void {
  if (triggersBound) return;
  triggersBound = true;
  let prefetchTimer = 0;
  const schedulePrefetch = (event: Event): void => {
    window.clearTimeout(prefetchTimer);
    const playerId = triggerPlayerId(playerTrigger(event.target));
    if (playerId) {
      prefetchTimer = window.setTimeout(() => {
        prefetchProfile(playerId);
      }, 120);
    }
  };
  document.addEventListener("pointerover", schedulePrefetch);
  document.addEventListener("focusin", schedulePrefetch);
  document.addEventListener("pointerdown", (event) => {
    const playerId = triggerPlayerId(playerTrigger(event.target));
    if (playerId) prefetchProfile(playerId);
  });
  document.addEventListener("click", (event) => {
    const trigger = playerTrigger(event.target);
    const playerId = triggerPlayerId(trigger);
    if (!playerId) return;
    event.preventDefault();
    void openPlayerPopup(playerId, trigger);
  });
}
