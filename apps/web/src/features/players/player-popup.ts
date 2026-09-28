// The player profile popup of the players list and the leaderboards, filled from
// /api/players/:id/profile.

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
  mscFriendCodeLines,
  parseCodeLine,
  switchFriendCodeLines,
  text,
  type Accolade,
  type PlayerProfile,
  type SeasonAward,
} from "./profile-data.ts";

const popup = new TemplatePopup({
  templateUrl: "/pages/templates/player-profile-popup.html?v=20260902-season-visuals-v5",
  openClass: "player-popup-open",
  closeButtonSelector: ".player-popup-close",
  openError: {
    id: "player-profile-feedback",
    className: "players-note players-note-error",
    message: "Could not open the player profile. ",
    mountIds: ["players-root", "leaderboards-root"],
  },
});

export function toPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Loads the popup ahead of the first click. */
export function ensurePopup(): Promise<HTMLElement> {
  return popup.ensure();
}

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
  const season = text(entry?.season_name).trim();
  const award = text(entry?.award_name).trim() || "-";
  return [
    '<li class="player-popup-season-award-item">',
    `<span class="player-popup-season-award-season">${escapeHtml(season)}</span>`,
    ballImage("player-popup-season-award-ball", entry?.game_code),
    `<span class="player-popup-season-award-name">${escapeHtml(award)}</span>`,
    "</li>",
  ].join("");
}

function accoladeItem(entry: Accolade | null | undefined): string {
  const medal = text(entry?.place_medal || "•").trim() || "•";
  const name = text(entry?.tournament_name).trim() || "-";
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
  popup.setText("player-name", text(player.name || "-"));
  renderFlag(player.country);
  renderCodeLines("fc-switch", switchFriendCodeLines(friendCodes));
  renderCodeLines("fc-msc", mscFriendCodeLines(friendCodes));
  renderResultsLink(text(player.results_url).trim());
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

export async function openPlayerPopup(playerId: number, opener: HTMLElement | null): Promise<void> {
  if (!toPositiveInt(playerId)) return;
  const request = popup.begin();
  try {
    await popup.ensure();
    if (!popup.isCurrent(request)) return;
    popup.open(opener);
    popup.setText("player-name", "");
    const staleFlag = popup.slots["player-flag"];
    if (staleFlag) {
      staleFlag.hidden = true;
      staleFlag.removeAttribute("src");
    }
    popup.showStatus("Loading...");

    const profile = await fetchJson<PlayerProfile | null>(
      `/api/players/${encodeURIComponent(String(playerId))}/profile`,
    );
    if (!popup.isCurrent(request) || !popup.isOpen) return;
    renderProfile(profile ?? {});
    popup.showStatus(null);
  } catch {
    if (!popup.isCurrent(request)) return;
    if (popup.isOpen) popup.showStatus("Failed to load player profile.", true);
    else popup.showOpenError(() => void openPlayerPopup(playerId, opener));
  }
}

let triggersBound = false;

/** Player names in the players list and the leaderboards open the popup. */
export function bindPlayerProfileTriggers(): void {
  if (triggersBound) return;
  triggersBound = true;
  document.addEventListener("click", (event) => {
    const trigger =
      event.target instanceof Element ? event.target.closest(".players-name-trigger, .lb-player-trigger") : null;
    if (!(trigger instanceof HTMLElement)) return;
    const playerId = toPositiveInt(trigger.getAttribute("data-player-id"));
    if (!playerId) return;
    event.preventDefault();
    void openPlayerPopup(playerId, trigger);
  });
}
