// MSBL clubs as the API sends them, and the readings the club list and the club popup share.

import { toText } from "@ms/shared/text";
import { escapeHtml } from "@ms/shared/html";

export interface Club {
  readonly club_id?: unknown;
  readonly name?: unknown;
  readonly tag?: unknown;
  readonly status?: unknown;
  readonly join_conditions?: unknown;
  readonly member_count?: unknown;
  readonly is_active?: unknown;
  readonly region?: unknown;
  readonly regions?: unknown;
  readonly club_code?: unknown;
  readonly club_codes?: unknown;
  readonly logo?: unknown;
  readonly discord_server?: unknown;
  readonly first_uniform?: unknown;
  readonly second_uniform?: unknown;
  readonly stadium?: unknown;
  readonly created_at?: unknown;
}

export const NO_CLUB_LOGO_URL = "../assets/clubs/no-club-logo.png";

/** A list or a single value as trimmed, non-empty strings. */
export function textList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return (value as unknown[]).map((entry) => toText(entry).trim()).filter(Boolean);
  }
  const single = toText(value).trim();
  return single ? [single] : [];
}

export function isClubActive(club: Club | null | undefined): boolean {
  return club?.is_active === true;
}

export function clubRegions(club: Club | null | undefined): string[] {
  const regions = textList(club?.regions);
  return regions.length ? regions : textList(club?.region);
}

type StatusVariant = "invite-only" | "open-to-anyone" | "default";

export function statusVariant(status: string): StatusVariant {
  const normalized = status.trim().toLowerCase();
  if (normalized === "invite only") return "invite-only";
  if (normalized === "open to anyone") return "open-to-anyone";
  return "default";
}

export function statusClass(baseClass: string, status: string): string {
  const variant = statusVariant(status);
  return variant === "default" ? baseClass : `${baseClass} is-${variant}`;
}

/** The join condition, with the lock icon for invite-only clubs. */
export function statusHtml(status: string): string {
  const trimmed = status.trim();
  if (!trimmed) return "-";
  const label = `<span class="msbl-club-status-text">${escapeHtml(trimmed)}</span>`;
  return statusVariant(trimmed) === "invite-only"
    ? `<img class="msbl-club-status-icon" src="../assets/clubs/invite-only.png" alt="" aria-hidden="true">${label}`
    : label;
}

/** The club logo (cached by the API, or an absolute URL), or "" for none. */
export function logoUrl(club: Club | null | undefined): string {
  const raw = toText(club?.logo).trim();
  if (!raw) return "";
  if (/^\/(?!\/)/.test(raw)) return raw;
  return /^https?:\/\//i.test(raw) ? raw : "";
}
