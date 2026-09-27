// Numeric coercion helpers with deliberately distinct semantics; do not collapse them into one.

/** Strict positive integer ("12.5" is rejected), else null. Used for ids from URLs. */
export function toPositiveIntId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Any finite number above 0, floored, else null. */
export function toPositiveIntOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

/** Any finite number above 0, floored, else the fallback. */
export function toPositiveIntOr<T>(value: unknown, fallback: T): number | T {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Any finite number, floored and clamped to at least 0, else 0. */
export function toSafeCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}
