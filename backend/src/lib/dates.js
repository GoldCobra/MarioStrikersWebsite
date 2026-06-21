// Shared date/activity helpers. Leaf module: no imports from services/db.
//
// NB: toIsoString is intentionally NOT shared here — leaderboards-service and
// competitive-season-service use the same name with different fallbacks
// (current-time vs null), so each keeps its own.

const DEFAULT_ACTIVITY_WINDOW_DAYS = 90;

function normalizeActivityDate(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return date;
}

function toActivityIso(value) {
  const date = normalizeActivityDate(value);
  return date ? date.toISOString() : null;
}

function isActivityActive(value, now, activityWindowDays) {
  const activity = normalizeActivityDate(value);
  const reference = normalizeActivityDate(now) || new Date();
  const windowDays = Number.isFinite(Number(activityWindowDays))
    ? Number(activityWindowDays)
    : DEFAULT_ACTIVITY_WINDOW_DAYS;

  if (!activity || windowDays <= 0) {
    return false;
  }

  return reference.getTime() - activity.getTime() <= windowDays * 24 * 60 * 60 * 1000;
}

function toIsoDateOnly(value) {
  if (!value) {
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

module.exports = {
  DEFAULT_ACTIVITY_WINDOW_DAYS,
  normalizeActivityDate,
  toActivityIso,
  isActivityActive,
  toIsoDateOnly
};
