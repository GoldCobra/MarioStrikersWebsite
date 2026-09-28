// The community tournaments page: current events from /api/events/community, each linking to its
// Discord channel.

import { escapeHtml } from "@ms/shared/html";
import { toText } from "@ms/shared/text";
import { fetchJson } from "../../lib/api.ts";

interface CommunityEvent {
  readonly display_name?: unknown;
  readonly name?: unknown;
  readonly url?: unknown;
  readonly image_url?: unknown;
}

function rowHtml(event: CommunityEvent | null | undefined): string {
  const url = toText(event?.url).trim();
  if (!url) return "";
  const name = toText(event?.display_name || event?.name).trim() || "EVENT";
  const imageUrl = toText(event?.image_url).trim();
  const icon = imageUrl
    ? `<img class="events-game-ball" src="${escapeHtml(imageUrl)}" alt="" aria-hidden="true" data-on-error="remove">`
    : "";
  return [
    '<article class="lb-row players-row events-row" role="listitem">',
    `<a class="events-row-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="Open Discord channel for ${escapeHtml(name)}">`,
    '<div class="lb-inner-frame players-inner-frame">',
    '<div class="lb-rank-cell players-flag-cell" aria-hidden="true">',
    `<span class="players-flag-slot">${icon}</span>`,
    "</div>",
    '<span class="lb-player players-name events-name">',
    `<span class="players-name-text events-name-text">${escapeHtml(name)}</span>`,
    "</span>",
    '<div class="lb-points players-points-spacer events-points-spacer" aria-hidden="true"></div>',
    "</div>",
    "</a>",
    "</article>",
  ].join("");
}

export async function initEventsList(mount: HTMLElement): Promise<void> {
  mount.innerHTML = '<p class="events-note loading-note">Loading...</p>';
  try {
    const payload = await fetchJson<{ rows?: unknown } | null>("/api/events/community");
    const events = Array.isArray(payload?.rows) ? (payload.rows as CommunityEvent[]) : [];
    if (!events.length) {
      mount.innerHTML = '<p class="events-note">No events are currently listed.</p>';
      return;
    }
    mount.innerHTML = [
      '<section class="leaderboard-block players-list-block events-list-block">',
      '<section class="leaderboard-list players-list events-list" role="list" aria-label="Current tournaments">',
      events.map(rowHtml).join(""),
      "</section>",
      "</section>",
    ].join("");
  } catch {
    mount.innerHTML = '<p class="events-note events-note-error">Events could not be loaded.</p>';
  }
}
