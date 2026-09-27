// The players page: every player, active ones first, then by name. A name opens the profile popup.

import { escapeHtml } from "@ms/shared/html";
import { fetchJson } from "../../lib/api.ts";
import { flagTitleAttribute, flagUrl, normalizeCountryCode } from "../../lib/countries.ts";
import { ensurePopup, toPositiveInt } from "./player-popup.ts";
import { text } from "./profile-data.ts";

interface PlayerRow {
  readonly player_id?: unknown;
  readonly name?: unknown;
  readonly display_name?: unknown;
  readonly country?: unknown;
  readonly is_active?: unknown;
}

function isActive(row: PlayerRow | null | undefined): boolean {
  return row?.is_active === true;
}

function sortName(row: PlayerRow | null | undefined): string {
  return text(row?.display_name || row?.name)
    .trim()
    .toLowerCase();
}

function comparePlayers(a: PlayerRow, b: PlayerRow): number {
  const activeDiff = Number(isActive(b)) - Number(isActive(a));
  if (activeDiff !== 0) return activeDiff;
  const nameA = sortName(a);
  const nameB = sortName(b);
  if (nameA !== nameB) return nameA < nameB ? -1 : 1;
  return (toPositiveInt(a.player_id) ?? 0) - (toPositiveInt(b.player_id) ?? 0);
}

function rowHtml(row: PlayerRow): string {
  const name = text(row.name).trim() || "-";
  const displayName = text(row.display_name || row.name).trim() || "-";
  const playerId = toPositiveInt(row.player_id);
  const countryCode = normalizeCountryCode(row.country);
  const rowClass = isActive(row) ? "lb-row players-row" : "lb-row players-row is-inactive";
  const flag = countryCode
    ? `<img class="players-flag" src="${escapeHtml(flagUrl(countryCode))}" alt="" aria-hidden="true"${flagTitleAttribute(countryCode)} loading="lazy" onerror="this.onerror=null;this.remove();">`
    : "";
  const nameInner = playerId
    ? `<button type="button" class="players-name-trigger" data-player-id="${playerId}" aria-haspopup="dialog" aria-controls="player-profile-popup" aria-label="Open profile for ${escapeHtml(name)}">${escapeHtml(displayName)}</button>`
    : `<span class="players-name-static">${escapeHtml(displayName)}</span>`;
  return [
    `<article class="${rowClass}" role="listitem">`,
    '<div class="lb-inner-frame players-inner-frame">',
    '<div class="lb-rank-cell players-flag-cell" aria-hidden="true">',
    `<span class="players-flag-slot">${flag}</span>`,
    "</div>",
    '<span class="lb-player players-name">',
    `<span class="players-name-text">${nameInner}</span>`,
    "</span>",
    '<div class="lb-points players-points-spacer" aria-hidden="true"></div>',
    "</div>",
    "</article>",
  ].join("");
}

export async function initPlayersList(mount: HTMLElement): Promise<void> {
  ensurePopup().catch(() => undefined);
  mount.innerHTML = '<p class="players-note loading-note">Loading...</p>';
  try {
    const payload = await fetchJson<{ rows?: unknown } | null>("/api/players");
    const rows = (Array.isArray(payload?.rows) ? (payload.rows as PlayerRow[]) : []).slice().sort(comparePlayers);
    if (!rows.length) {
      mount.innerHTML = '<p class="players-note">No players available.</p>';
      return;
    }
    mount.innerHTML = [
      '<section class="leaderboard-block players-list-block">',
      '<section class="leaderboard-list players-list" role="list" aria-label="Players list">',
      rows.map(rowHtml).join(""),
      "</section>",
      "</section>",
    ].join("");
  } catch {
    mount.innerHTML = '<p class="players-note players-note-error">Failed to load players.</p>';
  }
}
