// Date and activity helpers shared by the player and club lists.

export const DEFAULT_ACTIVITY_WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeActivityDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as string | number);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function toActivityIso(value: unknown): string | null {
  return normalizeActivityDate(value)?.toISOString() ?? null;
}

/** True when the activity lies within the window (default 90 days) before `now`. */
export function isActivityActive(value: unknown, now?: unknown, activityWindowDays?: unknown): boolean {
  const activity = normalizeActivityDate(value);
  const reference = normalizeActivityDate(now) ?? new Date();
  const windowDays = Number.isFinite(Number(activityWindowDays))
    ? Number(activityWindowDays)
    : DEFAULT_ACTIVITY_WINDOW_DAYS;
  if (!activity || windowDays <= 0) return false;
  return reference.getTime() - activity.getTime() <= windowDays * DAY_MS;
}

/** "YYYY-MM-DD" in UTC, or "" for missing or invalid dates. */
export function toIsoDateOnly(value: unknown): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}
