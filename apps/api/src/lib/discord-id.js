// Shared Discord snowflake normalization. Mention-aware superset:
// accepts a bare snowflake or a <@id> / <@!id> mention (optionally followed by
// text) and returns the bare id, else "". Leaf module (only depends on text).

const { normalizeText } = require("./text");

function normalizeDiscordId(value) {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }

  const mentionMatch = text.match(/<@!?(\d+)>/);
  if (mentionMatch) {
    return mentionMatch[1];
  }

  return /^\d+$/.test(text) ? text : "";
}

module.exports = { normalizeDiscordId };
