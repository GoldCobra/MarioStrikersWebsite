// My Club's card: the club popup's card (club-profile-popup.html, the same markup and styles) as a section of the
// page, like the profile page shows the player popup's card: no overlay, no close button, no dialog role, no
// loading line. Instead of the popup's compact lines it holds My Club's own sections, in the popup's look.

import { escapeHtml } from "@ms/shared/html";
import { templateView, type TemplateView } from "../../lib/popup.ts";
import template from "../clubs/club-profile-popup.html?raw";

export interface ClubCard {
  /** #club-profile-page, the card's root. */
  readonly root: HTMLElement;
  readonly view: TemplateView;
  /** The card's content (.club-popup-content), where the sections go. */
  readonly content: HTMLElement;
}

export function createClubCard(): ClubCard {
  const host = document.createElement("div");
  host.innerHTML = template.trim();
  const card = host.querySelector<HTMLElement>(".club-popup-card");
  if (!card) throw new Error("Invalid club template.");
  card.removeAttribute("role");
  card.removeAttribute("aria-modal");
  card.querySelector(".club-popup-close")?.remove();
  card.querySelector("[data-slot='popup-status']")?.remove();
  // The compact lines and the roster are drawn by My Club itself.
  card.querySelector(".club-popup-meta-section")?.remove();
  card.querySelector(".club-popup-roster-section")?.remove();
  const content = card.querySelector<HTMLElement>("[data-slot='popup-content']");
  if (!content) throw new Error("Invalid club template.");
  content.removeAttribute("hidden");
  const root = document.createElement("div");
  root.id = "club-profile-page";
  root.append(card);
  return { root, view: templateView(root), content };
}

/** A section of the card in the popup's look: its heading, then its content. */
export function sectionHtml(key: string, title: string, inner: string, actions = ""): string {
  return [
    `<section class="player-popup-section my-club-section" data-my-club-section="${escapeHtml(key)}">`,
    actions ? `<span class="profile-section-actions">${actions}</span>` : "",
    `<h3 class="player-popup-section-title">${escapeHtml(title)}</h3>`,
    inner,
    "</section>",
  ].join("");
}

/** A line of a section, in the field boxes' look. */
export function rowHtml(inner: string, extraClass = ""): string {
  return `<div class="player-popup-code-row${extraClass}">${inner}</div>`;
}

/**
 * The text of a line that says something (an invitation, the activity): its main line and an optional detail line
 * in small type. Both wrap instead of being cut off, so the line's buttons always keep their room.
 */
export function lineTextHtml(primary: string, detail = ""): string {
  return [
    '<span class="my-club-line-text">',
    `<span class="my-club-line-primary">${escapeHtml(primary)}</span>`,
    detail ? `<span class="my-club-line-detail">${escapeHtml(detail)}</span>` : "",
    "</span>",
  ].join("");
}

/**
 * A note in place of a line's button ("Rejoin from" above "4 Dec 2026"): two short lines, so the column of the
 * list's buttons stays about as narrow as a button and leaves the names their room.
 */
export function noteHtml(label: string, date: string): string {
  return `<span class="my-club-note"><span>${escapeHtml(label)}</span><span>${escapeHtml(date)}</span></span>`;
}

/** A small button of a line ("Accept", "Remove"); `action` goes to data-club-action. */
export function lineButton(action: string, label: string, attributes = "", variant = ""): string {
  return `<button class="profile-action-button my-club-line-button${variant ? ` is-${variant}` : ""}" type="button" data-club-action="${escapeHtml(action)}" ${attributes}>${escapeHtml(label)}</button>`;
}

const DATE = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });
const DATE_TIME = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

/** A date never breaks across lines: its spaces are non-breaking. */
function unbroken(text: string): string {
  return text.replace(/\s/gu, "\u00a0");
}

/** "19 Nov 2026" in the visitor's time zone, on one line; "" for a missing date. */
export function dateText(iso: string | null | undefined): string {
  const time = Date.parse(iso ?? "");
  return Number.isFinite(time) ? unbroken(DATE.format(time)) : "";
}

/** "19 Nov 2026, 16:05" in the visitor's time zone, on one line; "" for a missing date. */
export function dateTimeText(iso: string | null | undefined): string {
  const time = Date.parse(iso ?? "");
  return Number.isFinite(time) ? unbroken(DATE_TIME.format(time)) : "";
}
