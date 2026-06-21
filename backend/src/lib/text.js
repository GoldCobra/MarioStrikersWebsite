// Shared text helpers. Leaf module: no imports from services/db (avoids cycles).

function normalizeText(value) {
  return String(value || "").trim();
}

module.exports = { normalizeText };
