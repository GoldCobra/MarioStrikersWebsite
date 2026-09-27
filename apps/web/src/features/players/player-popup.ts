// The player profile popup of the players list and the leaderboards: loaded from a template on first
// use, filled from /api/players/:id/profile, closed by its buttons, Escape or the backdrop, with focus
// kept inside while it is open.

import { escapeHtml } from "@ms/shared/html";
import { fetchJson } from "../../lib/api.ts";
import { countryDisplayName, flagUrl, normalizeCountryCode } from "../../lib/countries.ts";
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

const TEMPLATE_URL = "/pages/templates/player-profile-popup.html?v=20260902-season-visuals-v5";
const OPEN_CLASS = "player-popup-open";

interface PopupState {
  root: HTMLElement | null;
  slots: Record<string, HTMLElement | undefined>;
  lists: Record<string, HTMLElement | undefined>;
  activeRequest: symbol | null;
  opener: HTMLElement | null;
  isOpen: boolean;
}

const state: PopupState = { root: null, slots: {}, lists: {}, activeRequest: null, opener: null, isOpen: false };
let templateLoad: Promise<HTMLElement> | null = null;
let keyboardBound = false;

export function toPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function mapByAttribute(root: HTMLElement, attribute: string): Record<string, HTMLElement> {
  const map: Record<string, HTMLElement> = {};
  for (const node of Array.from(root.querySelectorAll<HTMLElement>(`[${attribute}]`))) {
    const key = (node.getAttribute(attribute) ?? "").trim();
    if (key) map[key] = node;
  }
  return map;
}

function mountTemplate(html: string): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html.trim();
  const root = wrapper.firstElementChild;
  if (!(root instanceof HTMLElement)) throw new Error("Invalid profile popup template.");
  document.body.appendChild(root);
  state.root = root;
  state.slots = mapByAttribute(root, "data-slot");
  state.lists = mapByAttribute(root, "data-list");

  const requestClose = (event?: Event): void => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
    closePopup();
  };
  for (const node of Array.from(root.querySelectorAll("[data-action='popup-close']"))) {
    node.addEventListener("click", requestClose);
  }
  root.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("[data-action='popup-close']")) requestClose(event);
  });
  bindKeyboard();
  return root;
}

/** Loads and mounts the popup once; a failed load is retried on the next request. */
export function ensurePopup(): Promise<HTMLElement> {
  if (state.root) return Promise.resolve(state.root);
  templateLoad ??= fetch(TEMPLATE_URL, { headers: { Accept: "text/html" }, cache: "no-cache" })
    .then((response) => {
      if (!response.ok) throw new Error("Failed to load player profile template.");
      return response.text();
    })
    .then(mountTemplate)
    .catch((error: unknown) => {
      templateLoad = null;
      throw error;
    });
  return templateLoad;
}

function openPopup(opener: HTMLElement | null): void {
  if (!state.root) return;
  state.opener = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  state.root.hidden = false;
  state.root.setAttribute("aria-hidden", "false");
  state.isOpen = true;
  document.body.classList.add(OPEN_CLASS);
  state.root.querySelector<HTMLElement>(".player-popup-close")?.focus({ preventScroll: true });
}

function focusableControls(card: Element): HTMLElement[] {
  return Array.from(
    card.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, summary, [tabindex]"),
  ).filter(
    (node) =>
      !(node as HTMLButtonElement).disabled &&
      node.tabIndex >= 0 &&
      node.getClientRects().length > 0 &&
      window.getComputedStyle(node).visibility !== "hidden",
  );
}

function bindKeyboard(): void {
  if (keyboardBound) return;
  keyboardBound = true;
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && (state.isOpen || state.activeRequest)) {
      event.preventDefault();
      event.stopPropagation();
      closePopup();
      return;
    }
    if (event.key !== "Tab" || !state.isOpen || !state.root) return;
    const card = state.root.querySelector(".popup-card");
    if (!card) return;
    const controls = focusableControls(card);
    if (!controls.length) return;
    const index = controls.indexOf(document.activeElement as HTMLElement);
    if (index === -1 || (event.shiftKey ? index === 0 : index === controls.length - 1)) {
      event.preventDefault();
      controls[event.shiftKey ? controls.length - 1 : 0]?.focus({ preventScroll: true });
    }
  });
  document.addEventListener("focusin", (event) => {
    if (!state.isOpen || !state.root) return;
    const card = state.root.querySelector(".popup-card");
    if (card && !(event.target instanceof Node && card.contains(event.target))) {
      card.querySelector<HTMLElement>(".popup-close")?.focus({ preventScroll: true });
    }
  });
}

function clearOpenError(): void {
  document.getElementById("player-profile-feedback")?.remove();
}

/** When the popup cannot even open, a retry note appears above the list. */
function showOpenError(playerId: number, opener: HTMLElement | null): void {
  clearOpenError();
  const mount = document.getElementById("players-root") ?? document.getElementById("leaderboards-root");
  if (!mount) return;
  const feedback = document.createElement("p");
  feedback.id = "player-profile-feedback";
  feedback.className = "players-note players-note-error";
  feedback.setAttribute("role", "alert");
  feedback.textContent = "Could not open the player profile. ";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "profile-action-button";
  retry.textContent = "Retry";
  retry.addEventListener("click", () => {
    void openPlayerPopup(playerId, opener);
  });
  feedback.appendChild(retry);
  mount.insertAdjacentElement("beforebegin", feedback);
}

function closePopup(): void {
  state.activeRequest = null;
  clearOpenError();
  if (!state.root) return;
  state.root.hidden = true;
  state.root.setAttribute("aria-hidden", "true");
  state.isOpen = false;
  document.body.classList.remove(OPEN_CLASS);
  if (state.opener?.isConnected) state.opener.focus({ preventScroll: true });
  state.opener = null;
}

function setSectionHidden(node: HTMLElement | undefined, hidden: boolean): void {
  const section = node?.closest<HTMLElement>(".player-popup-section");
  if (section) section.hidden = hidden;
}

function renderCodeLines(listKey: string, values: readonly unknown[]): void {
  const mount = state.lists[listKey];
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
  return `<img class="${className}" src="${escapeHtml(icon)}" alt="" aria-hidden="true" loading="lazy" onerror="this.onerror=null;this.src='${escapeHtml(fallback)}'">`;
}

/** Collapsed list inside a <details>: hidden when empty, closed on every new profile. */
function renderDetailsList<T>(
  listKey: string,
  detailsClass: string,
  entries: readonly T[],
  item: (entry: T) => string,
): void {
  const mount = state.lists[listKey];
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

function setText(slot: string, value: unknown): void {
  const node = state.slots[slot];
  if (node) node.textContent = text(value);
}

function renderFlag(country: unknown): void {
  const flag = state.slots["player-flag"] as HTMLImageElement | undefined;
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
  const section = state.slots["results-section"];
  const link = state.slots["results-link"] as HTMLAnchorElement | undefined;
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
  const singlesMount = state.slots["ratings-grid-singles"];
  const doublesMount = state.slots["ratings-grid-doubles"];
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
  setText("player-name", player.name || "-");
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

  const bannerSection = state.slots["rank-banner-section"];
  const banner = state.slots["rank-banner"];
  if (bannerSection && banner) {
    banner.removeAttribute("src");
    bannerSection.hidden = true;
  }
}

/** Shows the loading or error message instead of the profile, or the profile (message null). */
function showStatus(message: string | null, isError = false): void {
  const status = state.slots["popup-status"];
  const content = state.slots["popup-content"];
  if (status) {
    if (message === null) {
      status.hidden = true;
    } else {
      status.textContent = message;
      status.hidden = false;
    }
    status.classList.toggle("is-error", message !== null && isError);
  }
  if (content) content.hidden = message !== null;
}

export async function openPlayerPopup(playerId: number, opener: HTMLElement | null): Promise<void> {
  if (!toPositiveInt(playerId)) return;
  const request = Symbol("profile-request");
  state.activeRequest = request;
  clearOpenError();
  bindKeyboard();
  try {
    await ensurePopup();
    if (state.activeRequest !== request) return;
    openPopup(opener);
    setText("player-name", "");
    const staleFlag = state.slots["player-flag"];
    if (staleFlag) {
      staleFlag.hidden = true;
      staleFlag.removeAttribute("src");
    }
    showStatus("Loading...");

    const profile = await fetchJson<PlayerProfile | null>(
      `/api/players/${encodeURIComponent(String(playerId))}/profile`,
    );
    if (state.activeRequest !== request || !state.isOpen) return;
    renderProfile(profile ?? {});
    showStatus(null);
  } catch {
    if (state.activeRequest !== request) return;
    if (state.isOpen) showStatus("Failed to load player profile.", true);
    else showOpenError(playerId, opener);
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
