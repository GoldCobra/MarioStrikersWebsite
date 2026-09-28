// The MSBL clubs page: clubs with members, active ones first, then by size and name. A row opens the
// club popup (click, Enter or Space).

import { escapeHtml } from "@ms/shared/html";
import { fetchJson } from "../../lib/api.ts";
import { scaleFitText } from "../../lib/fit-text.ts";
import {
  NO_CLUB_LOGO_URL,
  clubRegions,
  isClubActive,
  logoUrl,
  positiveInt,
  statusClass,
  statusHtml,
  text,
  type Club,
} from "./club-data.ts";
import { openClubPopup } from "./club-popup.ts";

const ACTIVE_MEMBERS_ICON_URL = "../assets/clubs/members.png";
const INACTIVE_MEMBERS_ICON_URL = "../assets/clubs/inactive-members.png";

// The row image is 1600x110; the name and meta slots are placed in whole pixels on it.
const GEOMETRY_VARS = [
  "--msbl-club-row-pixel-height",
  "--msbl-club-name-slot-top",
  "--msbl-club-name-slot-height",
  "--msbl-club-name-line-height",
  "--msbl-club-meta-slot-top",
  "--msbl-club-meta-slot-height",
] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function slotMetrics(rowHeight: number): {
  nameTop: number;
  nameHeight: number;
  metaTop: number;
  metaHeight: number;
} {
  const compact = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 430px)").matches;
  if (!compact) {
    return {
      nameTop: Math.round(rowHeight / 2 - 28),
      nameHeight: 28,
      metaTop: Math.round(rowHeight / 2 + 3),
      metaHeight: 18,
    };
  }
  const viewport = Math.max(0, document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const nameOffset = Math.round(clamp(viewport * 0.027, 10, 12));
  const nameHeight = Math.round(clamp(viewport * 0.03, 10, 13));
  const metaOffset = Math.round(clamp(viewport * 0.0055, 2, 3));
  const metaHeight = Math.round(clamp(viewport * 0.02, 7, 9));
  return {
    nameTop: Math.round(rowHeight / 2 - nameOffset - 1),
    nameHeight,
    metaTop: Math.round(rowHeight / 2 + metaOffset + 1 - 2),
    metaHeight,
  };
}

function setStyleVar(node: HTMLElement, name: string, value: string): void {
  if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
}

/** Sizes the row image and its text slots in whole pixels, so the text never blurs between two. */
function stabilizeGeometry(mount: HTMLElement): void {
  const list = mount.querySelector<HTMLElement>(".msbl-clubs-list");
  const firstRow = list?.querySelector(".msbl-club-row");
  if (!list || !firstRow) return;
  if (window.getComputedStyle(firstRow).display !== "block") {
    for (const name of GEOMETRY_VARS) list.style.removeProperty(name);
    return;
  }
  const rowWidth = firstRow.getBoundingClientRect().width;
  if (!rowWidth || !Number.isFinite(rowWidth)) return;
  const rowHeight = Math.max(2, Math.round((rowWidth * 110) / 1600 / 2) * 2);
  const slots = slotMetrics(rowHeight);
  setStyleVar(list, "--msbl-club-row-pixel-height", `${rowHeight}px`);
  setStyleVar(list, "--msbl-club-name-slot-top", `${slots.nameTop}px`);
  setStyleVar(list, "--msbl-club-name-slot-height", `${slots.nameHeight}px`);
  setStyleVar(list, "--msbl-club-name-line-height", `${slots.nameHeight}px`);
  setStyleVar(list, "--msbl-club-meta-slot-top", `${slots.metaTop}px`);
  setStyleVar(list, "--msbl-club-meta-slot-height", `${slots.metaHeight}px`);
}

/** Re-runs the geometry and the name fitting after fonts load and whenever the list resizes. */
function watchLayout(mount: HTMLElement): void {
  let frame: number | null = null;
  const run = (): void => {
    frame = null;
    stabilizeGeometry(mount);
    for (const name of Array.from(mount.querySelectorAll<HTMLElement>(".msbl-club-name"))) scaleFitText(name, 6);
  };
  const schedule = (): void => {
    frame ??= window.requestAnimationFrame(run);
  };
  run();
  schedule();
  void document.fonts.ready.then(schedule);
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(schedule);
    observer.observe(mount);
    const list = mount.querySelector(".msbl-clubs-list");
    if (list) observer.observe(list);
  } else {
    window.addEventListener("resize", schedule);
  }
}

function logoHtml(club: Club, fallbackText: string): string {
  const url = logoUrl(club);
  if (!url) {
    return `<div class="msbl-club-logo-slot"><img class="msbl-club-logo-img msbl-club-logo-fallback" src="${NO_CLUB_LOGO_URL}" alt="" aria-hidden="true"></div>`;
  }
  return [
    '<div class="msbl-club-logo-slot">',
    `<img class="msbl-club-logo-img" src="${escapeHtml(url)}" alt="${escapeHtml(fallbackText)} club logo" loading="lazy" referrerpolicy="no-referrer" data-fallback-src="${NO_CLUB_LOGO_URL}" data-fallback-alt="" data-fallback-class="msbl-club-logo-fallback">`,
    "</div>",
  ].join("");
}

function metaHtml(club: Club, active: boolean): string {
  const tag = text(club.tag).trim();
  const status = text(club.status).trim() || "-";
  const regions = clubRegions(club);
  const memberIcon = active ? ACTIVE_MEMBERS_ICON_URL : INACTIVE_MEMBERS_ICON_URL;
  return [
    `<span class="msbl-club-meta-item msbl-club-tag-meta">${escapeHtml(tag || "-")}</span>`,
    `<span class="${statusClass("msbl-club-meta-item msbl-club-status", status)}">${statusHtml(status)}</span>`,
    `<span class="msbl-club-meta-item msbl-club-extra">${escapeHtml(regions.length ? regions.join(" | ") : "-")}</span>`,
    '<span class="msbl-club-meta-item msbl-club-members">',
    `<img class="msbl-club-members-icon" src="${memberIcon}" alt="" aria-hidden="true">`,
    `<span class="msbl-club-members-text">${escapeHtml(Number(club.member_count || 0))}</span>`,
    "</span>",
  ].join("");
}

function rowHtml(club: Club): string {
  const clubId = positiveInt(club.club_id);
  const tag = text(club.tag).trim();
  const name = text(club.name).trim();
  const active = isClubActive(club);
  const label = name || tag || "Club";
  const interactive = clubId
    ? ` data-club-id="${clubId}" tabindex="0" aria-label="Open profile for ${escapeHtml(label)}"`
    : "";
  return [
    `<article class="${active ? "msbl-club-row" : "msbl-club-row is-inactive"}" role="listitem"${interactive}>`,
    logoHtml(club, label),
    '<div class="msbl-club-main">',
    `<div class="msbl-club-primary"><span class="msbl-club-name">${escapeHtml(name || "-")}</span></div>`,
    `<div class="msbl-club-meta">${metaHtml(club, active)}</div>`,
    "</div>",
    "</article>",
  ].join("");
}

function compareClubs(a: Club, b: Club): number {
  const activeDiff = Number(isClubActive(b)) - Number(isClubActive(a));
  if (activeDiff !== 0) return activeDiff;
  const memberDiff = Number(b.member_count || 0) - Number(a.member_count || 0);
  if (memberDiff !== 0) return memberDiff;
  const nameA = text(a.name).trim().toLowerCase();
  const nameB = text(b.name).trim().toLowerCase();
  if (nameA !== nameB) return nameA < nameB ? -1 : 1;
  const tagA = text(a.tag).trim().toLowerCase();
  const tagB = text(b.tag).trim().toLowerCase();
  if (tagA === tagB) return 0;
  return tagA < tagB ? -1 : 1;
}

function rowOf(event: Event): HTMLElement | null {
  return event.target instanceof Element ? event.target.closest<HTMLElement>(".msbl-club-row[data-club-id]") : null;
}

export async function initClubsList(mount: HTMLElement): Promise<void> {
  mount.innerHTML = '<p class="msbl-clubs-note loading-note">Loading...</p>';
  try {
    const payload = await fetchJson<{ rows?: unknown } | null>("/api/clubs/msbl");
    const clubs = (Array.isArray(payload?.rows) ? (payload.rows as Club[]) : [])
      .filter((club) => Number(club.member_count || 0) > 0)
      .sort(compareClubs);
    if (!clubs.length) {
      mount.innerHTML = '<p class="msbl-clubs-note">No clubs available.</p>';
      return;
    }
    mount.innerHTML = `<section class="msbl-clubs-list" role="list" aria-label="MSBL clubs list">${clubs.map(rowHtml).join("")}</section>`;
    watchLayout(mount);

    mount.addEventListener("click", (event) => {
      const row = rowOf(event);
      const clubId = positiveInt(row?.getAttribute("data-club-id"));
      if (row && clubId) void openClubPopup(clubId, row);
    });
    mount.addEventListener("keydown", (event) => {
      const row = rowOf(event);
      if (!row || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      const clubId = positiveInt(row.getAttribute("data-club-id"));
      if (clubId) void openClubPopup(clubId, row);
    });
  } catch {
    mount.innerHTML = '<p class="msbl-clubs-note msbl-clubs-note-error">Failed to load clubs.</p>';
  }
}
