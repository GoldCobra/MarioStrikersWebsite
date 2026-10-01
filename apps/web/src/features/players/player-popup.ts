// The player profile popup of the players list and the leaderboards, filled from
// /api/players/:id/profile.

import { toPositiveInt } from "@ms/shared/text";
import { fetchJson } from "../../lib/api.ts";
import { TemplatePopup } from "../../lib/popup.ts";
import { fitPlayerCard } from "./player-card.ts";
import { clearPlayerProfileHeader, renderPlayerProfile } from "./player-profile-view.ts";
import type { PlayerProfile } from "./profile-data.ts";
import template from "./player-profile-popup.html?raw";

const popup = new TemplatePopup({
  template,
  openClass: "player-popup-open",
  closeButtonSelector: ".player-popup-close",
});

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
    clearPlayerProfileHeader(popup);
    popup.showStatus("Failed to load player profile.", true);
  } else {
    renderPlayerProfile(popup, profile ?? {});
    popup.showStatus(null);
  }
  popup.open(opener);
}

/** Resolves once the fonts and every image the card shows, CSS backgrounds and masks included, are there. */
async function cardAssetsLoaded(root: HTMLElement): Promise<void> {
  const urls = new Set<string>();
  const addUrls = (value: string): void => {
    for (const match of value.matchAll(/url\("?([^")]+)"?\)/g)) if (match[1]) urls.add(match[1]);
  };
  for (const element of [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]) {
    if (!element.getClientRects().length) continue;
    if (element instanceof HTMLImageElement && element.currentSrc) urls.add(element.currentSrc);
    for (const pseudo of [null, "::before", "::after"]) {
      const style = getComputedStyle(element, pseudo);
      addUrls(style.backgroundImage);
      addUrls(style.getPropertyValue("mask-image"));
      addUrls(style.getPropertyValue("-webkit-mask-image"));
    }
  }
  await Promise.all([
    document.fonts.ready,
    ...Array.from(urls, async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode().catch(() => undefined);
    }),
  ]);
}

/**
 * The compact player card (/player-card?player=<id>; is-card in player-popup.css): the popup without its
 * close button, season rewards, accolades and results link, which the Discord bot screenshots for
 * /profile show. <html data-player-card> turns "ready" once the card, its images and fonts are there
 * and the card is sized (player-card.ts), or "error".
 */
export async function showPlayerCard(playerId: number): Promise<void> {
  const state = document.documentElement.dataset;
  try {
    const id = toPositiveInt(playerId);
    const profile = id ? await loadProfile(id) : null;
    if (!profile?.player) throw new Error("Player not found.");
    const root = popup.ensure();
    root.classList.add("is-card");
    renderPlayerProfile(popup, profile);
    popup.showStatus(null);
    popup.open(null);
    await cardAssetsLoaded(root);
    const card = root.querySelector<HTMLElement>(".player-popup-card");
    if (card) fitPlayerCard(card);
    state.playerCard = "ready";
  } catch {
    state.playerCard = "error";
  }
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
