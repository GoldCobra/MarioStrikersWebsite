// Shared numeric coercion helpers. Leaf module: no imports from services/db.
//
// These intentionally have DISTINCT semantics — do not collapse them into one:
//  - toPositiveIntId   : strict integers only (rejects "12.5"); else null.
//  - toPositiveIntOrNull: any finite > 0, floored; else null.
//  - toPositiveIntOr   : any finite > 0, floored; else the provided fallback.
//  - toSafeCount       : any finite, floored to >= 0; else 0.

function toPositiveIntId(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function toPositiveIntOrNull(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

function toPositiveIntOr(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function toSafeCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.floor(parsed));
}

module.exports = {
  toPositiveIntId,
  toPositiveIntOrNull,
  toPositiveIntOr,
  toSafeCount
};
