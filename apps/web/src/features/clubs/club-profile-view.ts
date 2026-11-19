// A club profile as the club popup shows it, filled into a copy of club-profile-popup.html: the popup itself and
// the member's club on My Club (/my-club) use this one markup, these pieces and these styles.

import { toText } from "@ms/shared/text";
import { escapeHtml } from "@ms/shared/html";
import { flagTitleAttribute, flagUrl, normalizeCountryCode } from "../../lib/countries.ts";
import { scaleFitText } from "../../lib/fit-text.ts";
import type { TemplateView } from "../../lib/popup.ts";
import { clubRegions, logoUrl, statusClass, statusHtml, statusVariant, textList, type Club } from "./club-data.ts";

export interface RosterEntry {
  readonly name?: unknown;
  readonly country?: unknown;
  readonly discord_name?: unknown;
  readonly role?: unknown;
}

export interface ClubProfile {
  readonly club?: Club | null;
  readonly roster?: unknown;
}

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

function statusSpan(status: string): string {
  return `<span class="${statusClass("club-popup-meta-condition", status)}">${statusHtml(status)}</span>`;
}

/** A region as its coloured badge. */
export function regionBadgeHtml(region: string): string {
  const badge = REGION_BADGE_CLASSES[region.trim().toUpperCase()] ?? "is-unknown";
  return `<span class="club-popup-region-badge ${badge}">${escapeHtml(region)}</span>`;
}

/** Open clubs show their club codes; others their join condition. Regions follow as badges. */
function renderClubInfo(view: TemplateView, club: Club | null): void {
  const line = view.slots["club-line-primary"];
  const status = toText(club?.join_conditions).trim();
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
  const regions = view.slots["club-line-regions"];
  if (regions) {
    regions.hidden = false;
    regions.innerHTML = clubRegions(club).map(regionBadgeHtml).join("");
  }
}

/** A uniform colour as the popup's shirt icon; "" for an unknown colour. */
export function uniformIconHtml(slot: string, uniform: unknown): string {
  const label = toText(uniform).trim();
  const color = label ? (UNIFORM_COLORS[label.toLowerCase()] ?? "") : "";
  if (!color || !label) return "";
  return `<span class="club-popup-action-icon club-popup-uniform-icon" data-uniform-slot="${escapeHtml(slot)}" style="--club-uniform-color: ${escapeHtml(color)};" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"></span>`;
}

function renderEquipment(view: TemplateView, club: Club | null): void {
  const line = view.slots["club-equipment-line"];
  if (!line) return;
  const stadium = toText(club?.stadium).trim();
  line.hidden = false;
  line.innerHTML =
    uniformIconHtml("first", club?.first_uniform) +
    uniformIconHtml("second", club?.second_uniform) +
    (stadium ? `<span class="club-popup-stadium-label">${escapeHtml(stadium)}</span>` : "");
}

/** A discord.gg or discord.com/invite link, or "" for anything else. */
export function discordInviteUrl(value: unknown): string {
  const raw = toText(value).trim();
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

function renderActions(view: TemplateView, club: Club | null): void {
  const node = view.slots["club-actions"];
  if (!node) return;
  const url = discordInviteUrl(club?.discord_server);
  if (!url) {
    node.hidden = true;
    node.innerHTML = "";
    return;
  }
  node.innerHTML = `<a class="club-popup-discord-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="Open club Discord"></a>`;
  node.hidden = false;
}

/** "2026-11-19", or "" for a missing or invalid date. */
export function createdDate(value: unknown): string {
  const raw = toText(value).trim();
  if (!raw) return "";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

/**
 * The role's badge: CAPTAIN for the club's captain (the API's "owner" in the public profile, "captain" on My Club;
 * owner 2026-11-19) and OFFICER; nothing for a member.
 */
export function roleBadgeHtml(role: unknown): string {
  const normalized = toText(role).trim().toLowerCase();
  if (normalized !== "owner" && normalized !== "captain" && normalized !== "officer") return "";
  const look = normalized === "officer" ? "officer" : "owner";
  const label = normalized === "officer" ? "OFFICER" : "CAPTAIN";
  return `<span class="club-popup-role-badge is-${look}"><span class="club-popup-role-label">${label}</span></span>`;
}

/** One roster line: flag, name and Discord username, the role's badge, and `extra` (My Club's actions). */
export function rosterItemHtml(entry: RosterEntry | null | undefined, extra = ""): string {
  const countryCode = normalizeCountryCode(entry?.country);
  const flag = countryCode
    ? `<img class="club-popup-roster-flag" src="${escapeHtml(flagUrl(countryCode))}" alt="" aria-hidden="true"${flagTitleAttribute(countryCode)} loading="lazy" data-on-error="remove">`
    : '<span class="club-popup-roster-flag club-popup-roster-flag-empty" aria-hidden="true"></span>';
  const name = toText(entry?.name).trim() || "Unknown";
  const discordName = toText(entry?.discord_name).trim();
  return [
    '<li class="club-popup-roster-item">',
    flag,
    '<span class="club-popup-roster-player">',
    `<span class="club-popup-roster-name">${escapeHtml(name)}</span>`,
    discordName ? `<span class="club-popup-roster-discord-name">${escapeHtml(discordName)}</span>` : "",
    "</span>",
    roleBadgeHtml(entry?.role),
    extra,
    "</li>",
  ].join("");
}

function renderRoster(view: TemplateView, roster: readonly RosterEntry[]): void {
  const mount = view.lists.roster;
  if (!mount) return;
  mount.innerHTML = roster.length
    ? roster.map((entry) => rosterItemHtml(entry)).join("")
    : '<li class="club-popup-roster-item is-empty">No roster available.</li>';
}

/** The club's logo behind the card's content, or none. */
export function renderClubLogo(view: TemplateView, club: Club | null): void {
  const logo = view.slots["club-logo-bg"] as HTMLImageElement | undefined;
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

/** "Name [TAG]" in the header, scaled down to fit its line. */
export function renderClubName(view: TemplateView, club: Club | null): void {
  const name = toText(club?.name).trim() || "-";
  const tag = toText(club?.tag).trim();
  const nameNode = view.slots["club-name"];
  if (!nameNode) return;
  nameNode.innerHTML = tag
    ? `${escapeHtml(name)} <span class="club-popup-tag-label">[${escapeHtml(tag)}]</span>`
    : escapeHtml(name);
  window.requestAnimationFrame(() => {
    scaleFitText(nameNode, 9);
  });
}

/** Empties what a previous club left in the card (before the next one is loaded). */
export function clearClubProfile(view: TemplateView): void {
  view.setText("club-name", "");
  renderClubInfo(view, null);
  view.setText("created-date", "");
  renderEquipment(view, null);
  renderActions(view, null);
  renderClubLogo(view, null);
}

export function renderClubProfile(view: TemplateView, profile: ClubProfile | null): void {
  const club = profile?.club ?? {};
  renderClubName(view, club);
  renderClubInfo(view, club);
  view.setText("created-date", createdDate(club.created_at));
  renderEquipment(view, club);
  renderActions(view, club);
  renderClubLogo(view, club);
  renderRoster(view, Array.isArray(profile?.roster) ? (profile.roster as RosterEntry[]) : []);
}
