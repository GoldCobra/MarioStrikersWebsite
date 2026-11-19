// The club popup of the clubs page, filled from /api/clubs/msbl/:id/profile (club-profile-view.ts draws it); a
// profile stays cached for 30 seconds, so reopening a club shows it at once.

import { toPositiveInt } from "@ms/shared/text";
import { TemplatePopup } from "../../lib/popup.ts";
import { clearClubProfile, renderClubProfile, type ClubProfile } from "./club-profile-view.ts";
import template from "./club-profile-popup.html?raw";

const PROFILE_CACHE_TTL_MS = 30_000;

const popup = new TemplatePopup({
  template,
  openClass: "popup-open",
  closeButtonSelector: ".club-popup-close",
});
const profileCache = new Map<number, { data: ClubProfile | null; time: number }>();

async function fetchClubProfile(clubId: number): Promise<ClubProfile | null> {
  const response = await fetch(`/api/clubs/msbl/${encodeURIComponent(String(clubId))}/profile`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Club profile request failed.");
  return (await response.json()) as ClubProfile | null;
}

export async function openClubPopup(clubIdRaw: unknown, opener: HTMLElement | null): Promise<void> {
  const clubId = toPositiveInt(clubIdRaw);
  if (!clubId) return;
  const request = popup.begin();
  try {
    popup.ensure();
    popup.open(opener);
    clearClubProfile(popup);

    const cached = profileCache.get(clubId);
    if (cached && Date.now() - cached.time < PROFILE_CACHE_TTL_MS) {
      renderClubProfile(popup, cached.data);
      popup.showStatus(null);
      return;
    }
    if (cached) profileCache.delete(clubId);
    popup.showStatus("Loading...");

    const profile = await fetchClubProfile(clubId);
    if (!popup.isCurrent(request) || !popup.isOpen) return;
    profileCache.set(clubId, { data: profile, time: Date.now() });
    renderClubProfile(popup, profile);
    popup.showStatus(null);
  } catch {
    if (popup.isCurrent(request) && popup.isOpen) popup.showStatus("Failed to load club profile.", true);
  }
}
