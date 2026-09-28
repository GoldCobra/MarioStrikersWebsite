// The club popup of the clubs page, filled from /api/clubs/msbl/:id/profile; a profile stays cached for
// 30 seconds, so reopening a club shows it at once.

import { escapeHtml } from "@ms/shared/html";
import { flagTitleAttribute, flagUrl, normalizeCountryCode } from "../../lib/countries.ts";
import { scaleFitText } from "../../lib/fit-text.ts";
import { TemplatePopup } from "../../lib/popup.ts";
import {
  clubRegions,
  logoUrl,
  positiveInt,
  statusClass,
  statusHtml,
  statusVariant,
  text,
  textList,
  type Club,
} from "./club-data.ts";

interface RosterEntry {
  readonly name?: unknown;
  readonly country?: unknown;
  readonly discord_name?: unknown;
  readonly role?: unknown;
}

interface ClubProfile {
  readonly club?: Club | null;
  readonly roster?: unknown;
}

const PROFILE_CACHE_TTL_MS = 30_000;

const UNIFORM_COLORS: Readonly<Record<string, string>> = {
  red: "#dc2626",
  pink: "#ec4899",
  orange: "#f97316",
  yellow: "#facc15",
  lime: "#84cc16",
  green: "#16a34a",
  black: "#111111",
  grey: "#6b7280",
  blue: "#2563eb",
  violet: "#7c3aed",
  lavender: "#a78bfa",
  turquoise: "#14b8a6",
};

const REGION_BADGE_CLASSES: Readonly<Record<string, string>> = {
  EU: "is-eu",
  NA: "is-na",
  SA: "is-sa",
  SSA: "is-ssa",
  APAC: "is-apac",
  OCE: "is-oce",
  MENA: "is-mena",
  OTHER: "is-other",
};

const popup = new TemplatePopup({
  templateUrl: "/pages/templates/club-profile-popup.html?v=20260602-equipment-row-v1",
  openClass: "popup-open",
  closeButtonSelector: ".club-popup-close",
  openError: {
    id: "club-profile-feedback",
    className: "msbl-clubs-note msbl-clubs-note-error",
    message: "Could not open the club profile. ",
    mountIds: ["msbl-clubs-root"],
  },
});
const profileCache = new Map<number, { data: ClubProfile | null; time: number }>();

function statusSpan(status: string): string {
  return `<span class="${statusClass("club-popup-meta-condition", status)}">${statusHtml(status)}</span>`;
}

/** Open clubs show their club codes; others their join condition. Regions follow as badges. */
function renderClubInfo(club: Club | null): void {
  const line = popup.slots["club-line-primary"];
  const status = text(club?.join_conditions).trim();
  if (line) {
    line.hidden = false;
    if (statusVariant(status) === "open-to-anyone") {
      const codes = textList(club?.club_codes).length ? textList(club?.club_codes) : textList(club?.club_code);
      if (codes.length) line.textContent = codes.join(" | ");
      else line.innerHTML = statusSpan(status);
    } else {
      line.innerHTML = status ? statusSpan(status) : "-";
    }
  }
  const regions = popup.slots["club-line-regions"];
  if (regions) {
    regions.hidden = false;
    regions.innerHTML = clubRegions(club)
      .map((region) => {
        const badge = REGION_BADGE_CLASSES[region.trim().toUpperCase()] ?? "is-unknown";
        return `<span class="club-popup-region-badge ${badge}">${escapeHtml(region)}</span>`;
      })
      .join("");
  }
}

function uniformIcon(slot: string, uniform: unknown): string {
  const label = text(uniform).trim();
  const color = label ? (UNIFORM_COLORS[label.toLowerCase()] ?? "") : "";
  if (!color || !label) return "";
  return `<span class="club-popup-action-icon club-popup-uniform-icon" data-uniform-slot="${escapeHtml(slot)}" style="--club-uniform-color: ${escapeHtml(color)};" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"></span>`;
}

function renderEquipment(club: Club | null): void {
  const line = popup.slots["club-equipment-line"];
  if (!line) return;
  const stadium = text(club?.stadium).trim();
  line.hidden = false;
  line.innerHTML =
    uniformIcon("first", club?.first_uniform) +
    uniformIcon("second", club?.second_uniform) +
    (stadium ? `<span class="club-popup-stadium-label">${escapeHtml(stadium)}</span>` : "");
}

/** A discord.gg or discord.com/invite link, or "" for anything else. */
function discordInviteUrl(club: Club | null): string {
  const raw = text(club?.discord_server).trim();
  if (!raw) return "";
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const parts = url.pathname.split("/").filter(Boolean);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || parts.length === 0) return "";
    if (host === "discord.gg") return url.href;
    if ((host === "discord.com" || host === "discordapp.com") && parts[0]?.toLowerCase() === "invite" && parts[1]) {
      return url.href;
    }
  } catch {
    return "";
  }
  return "";
}

function renderActions(club: Club | null): void {
  const node = popup.slots["club-actions"];
  if (!node) return;
  const url = discordInviteUrl(club);
  if (!url) {
    node.hidden = true;
    node.innerHTML = "";
    return;
  }
  node.innerHTML = `<a class="club-popup-discord-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="Open club Discord"></a>`;
  node.hidden = false;
}

function createdDate(value: unknown): string {
  const raw = text(value).trim();
  if (!raw) return "";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function roleBadge(role: unknown): string {
  const normalized = text(role).trim().toLowerCase();
  if (normalized !== "owner" && normalized !== "officer") return "";
  return `<span class="club-popup-role-badge is-${normalized}"><span class="club-popup-role-label">${normalized.toUpperCase()}</span></span>`;
}

function rosterItem(entry: RosterEntry | null | undefined): string {
  const countryCode = normalizeCountryCode(entry?.country);
  const flag = countryCode
    ? `<img class="club-popup-roster-flag" src="${escapeHtml(flagUrl(countryCode))}" alt="" aria-hidden="true"${flagTitleAttribute(countryCode)} loading="lazy" onerror="this.onerror=null;this.remove();">`
    : '<span class="club-popup-roster-flag club-popup-roster-flag-empty" aria-hidden="true"></span>';
  const name = text(entry?.name).trim() || "Unknown";
  const discordName = text(entry?.discord_name).trim();
  return [
    '<li class="club-popup-roster-item">',
    flag,
    '<span class="club-popup-roster-player">',
    `<span class="club-popup-roster-name">${escapeHtml(name)}</span>`,
    discordName ? `<span class="club-popup-roster-discord-name">${escapeHtml(discordName)}</span>` : "",
    "</span>",
    roleBadge(entry?.role),
    "</li>",
  ].join("");
}

function renderRoster(roster: readonly RosterEntry[]): void {
  const mount = popup.lists.roster;
  if (!mount) return;
  mount.innerHTML = roster.length
    ? roster.map(rosterItem).join("")
    : '<li class="club-popup-roster-item is-empty">No roster available.</li>';
}

function renderLogo(club: Club | null): void {
  const logo = popup.slots["club-logo-bg"] as HTMLImageElement | undefined;
  if (!logo) return;
  const url = logoUrl(club);
  if (url) {
    logo.src = url;
    logo.hidden = false;
  } else {
    logo.hidden = true;
    logo.removeAttribute("src");
  }
}

function renderProfile(profile: ClubProfile | null): void {
  const club = profile?.club ?? {};
  const name = text(club.name).trim() || "-";
  const tag = text(club.tag).trim();
  const nameNode = popup.slots["club-name"];
  if (nameNode) {
    nameNode.innerHTML = tag
      ? `${escapeHtml(name)} <span class="club-popup-tag-label">[${escapeHtml(tag)}]</span>`
      : escapeHtml(name);
  }
  renderClubInfo(club);
  popup.setText("created-date", createdDate(club.created_at));
  renderEquipment(club);
  renderActions(club);
  renderLogo(club);
  renderRoster(Array.isArray(profile?.roster) ? (profile.roster as RosterEntry[]) : []);
  if (nameNode) {
    window.requestAnimationFrame(() => {
      scaleFitText(nameNode, 9);
    });
  }
}

async function fetchClubProfile(clubId: number): Promise<ClubProfile | null> {
  const response = await fetch(`/api/clubs/msbl/${encodeURIComponent(String(clubId))}/profile`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Club profile request failed.");
  return (await response.json()) as ClubProfile | null;
}

export async function openClubPopup(clubIdRaw: unknown, opener: HTMLElement | null): Promise<void> {
  const clubId = positiveInt(clubIdRaw);
  if (!clubId) return;
  const request = popup.begin();
  try {
    await popup.ensure();
    if (!popup.isCurrent(request)) return;
    popup.open(opener);

    popup.setText("club-name", "");
    renderClubInfo(null);
    popup.setText("created-date", "");
    renderEquipment(null);
    renderActions(null);
    renderLogo(null);

    const cached = profileCache.get(clubId);
    if (cached && Date.now() - cached.time < PROFILE_CACHE_TTL_MS) {
      renderProfile(cached.data);
      popup.showStatus(null);
      return;
    }
    if (cached) profileCache.delete(clubId);
    popup.showStatus("Loading...");

    const profile = await fetchClubProfile(clubId);
    if (!popup.isCurrent(request) || !popup.isOpen) return;
    profileCache.set(clubId, { data: profile, time: Date.now() });
    renderProfile(profile);
    popup.showStatus(null);
  } catch {
    if (!popup.isCurrent(request)) return;
    if (popup.isOpen) popup.showStatus("Failed to load club profile.", true);
    else popup.showOpenError(() => void openClubPopup(clubId, opener));
  }
}
