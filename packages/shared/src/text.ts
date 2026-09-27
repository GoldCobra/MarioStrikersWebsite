/**
 * The string form of a loosely typed value: a database column, a query parameter or JSON from another
 * service. Falsy values (null, undefined, 0, false, "") become "", as String(value || "") did in the
 * previous API.
 */
export function toText(value: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- plain column and request values
  return value ? String(value) : "";
}

/** toText, trimmed. */
export function normalizeText(value: unknown): string {
  return toText(value).trim();
}
