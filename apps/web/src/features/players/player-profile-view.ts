// A player profile as the player popup shows it, filled into a copy of player-profile-popup.html: the
// popup itself, the Discord card (/player-card) and the signed-in player's profile page (/profile) all
// use this one markup and these styles.

import { toText } from "@ms/shared/text";
import { escapeHtml } from "@ms/shared/html";
import { countryDisplayName, flagUrl, normalizeCountryCode } from "../../lib/countries.ts";
import type { TemplateView } from "../../lib/popup.ts";
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

function setSectionHidden(node: HTMLElement | undefined, hidden: boolean): void {
  const section = node?.closest<HTMLElement>(".player-popup-section");
  if (section) section.hidden = hidden;
}

function renderCodeLines(view: TemplateView, listKey: string, values: readonly unknown[]): void {
  const mount = view.lists[listKey];
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
  view: TemplateView,
  listKey: string,
  detailsClass: string,
  entries: readonly T[],
  item: (entry: T) => string,
): void {
  const mount = view.lists[listKey];
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

function renderFlag(view: TemplateView, country: unknown): void {
  const flag = view.slots["player-flag"] as HTMLImageElement | undefined;
  if (flag) showFlag(flag, country);
}

/** The flag next to the name: the country's flag with its name as title, hidden without a country. */
export function showFlag(flag: HTMLImageElement, country: unknown): void {
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

/** An MSL World Champion's header turns gold and shows the MSL logo at its right end. */
function renderWorldChampion(view: TemplateView, champion: boolean): void {
  view.slots["player-header"]?.classList.toggle("is-world-champion", champion);
  const logo = view.slots["player-msl-champion"];
  if (logo) logo.hidden = !champion;
}

function renderResultsLink(view: TemplateView, url: string): void {
  const section = view.slots["results-section"];
  const link = view.slots["results-link"] as HTMLAnchorElement | undefined;
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

function renderRatings(view: TemplateView, profile: PlayerProfile): void {
  const ratings = profile.ratings ?? {};
  const singlesMount = view.slots["ratings-grid-singles"];
  const doublesMount = view.slots["ratings-grid-doubles"];
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

export function renderPlayerProfile(view: TemplateView, profile: PlayerProfile): void {
  const player = profile.player ?? {};
  const friendCodes = profile.friend_codes ?? {};
  view.setText("player-name", toText(player.name || "-"));
  renderFlag(view, player.country);
  renderWorldChampion(view, isWorldChampion(profile.accolades));
  renderCodeLines(view, "fc-switch", switchFriendCodeLines(friendCodes));
  renderCodeLines(view, "fc-msc", mscFriendCodeLines(friendCodes));
  renderResultsLink(view, toText(player.results_url).trim());
  renderDetailsList(
    view,
    "season-awards",
    ".player-popup-season-awards-details",
    profile.season_awards ?? [],
    seasonAwardItem,
  );
  renderDetailsList(view, "accolades", ".player-popup-accolades-details", profile.accolades ?? [], accoladeItem);
  renderRatings(view, profile);

  const bannerSection = view.slots["rank-banner-section"];
  const banner = view.slots["rank-banner"];
  if (bannerSection && banner) {
    banner.removeAttribute("src");
    bannerSection.hidden = true;
  }
}

export function clearPlayerProfileHeader(view: TemplateView): void {
  view.setText("player-name", "");
  renderFlag(view, null);
  renderWorldChampion(view, false);
}
