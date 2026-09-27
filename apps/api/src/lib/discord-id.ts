import { normalizeText } from "@ms/shared/text";

/**
 * Bare Discord snowflake from a stored value. Accepts a bare id or a <@id> / <@!id> mention,
 * optionally followed by text; anything else becomes "".
 */
export function normalizeDiscordId(value: unknown): string {
  const text = normalizeText(value);
  if (!text) return "";
  const mention = /<@!?(\d+)>/.exec(text);
  if (mention?.[1]) return mention[1];
  return /^\d+$/.test(text) ? text : "";
}
