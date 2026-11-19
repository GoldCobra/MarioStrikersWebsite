// SQL Server error numbers the API answers on purpose. No database code here: the fixtures use it too.

/** Duplicate key errors: unique index (2601) and unique constraint (2627). */
export function isUniqueViolation(error: unknown): boolean {
  const record = (error ?? {}) as { number?: unknown; originalError?: { info?: { number?: unknown } } };
  const number = record.number ?? record.originalError?.info?.number;
  return number === 2601 || number === 2627;
}

/** The unique index or key a duplicate key error names, e.g. "UX_Club_ClubName"; "" for other errors. */
export function duplicateKeyName(error: unknown): string {
  if (!isUniqueViolation(error)) return "";
  const message = error instanceof Error ? error.message : String(error);
  return /(?:unique index|constraint) '([^']+)'/.exec(message)?.[1] ?? "";
}

/** A deadlock victim (1205) or a lock request that timed out (1222): the transaction may simply be repeated. */
export function isDeadlock(error: unknown): boolean {
  const record = (error ?? {}) as { number?: unknown; originalError?: { info?: { number?: unknown } } };
  const number = record.number ?? record.originalError?.info?.number;
  return number === 1205 || number === 1222;
}
