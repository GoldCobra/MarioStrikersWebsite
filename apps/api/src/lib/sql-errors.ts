// SQL Server error numbers the API answers on purpose. No database code here: the fixtures use it too.

/** Duplicate key errors: unique index (2601) and unique constraint (2627). */
export function isUniqueViolation(error: unknown): boolean {
  const record = (error ?? {}) as { number?: unknown; originalError?: { info?: { number?: unknown } } };
  const number = record.number ?? record.originalError?.info?.number;
  return number === 2601 || number === 2627;
}
