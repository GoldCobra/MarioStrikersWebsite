const RANK_ORDER = [
  { level: 1, code: "rookie", name: "Rookie" },
  { level: 2, code: "professional", name: "Professional" },
  { level: 3, code: "superstar", name: "Superstar" },
  { level: 4, code: "legend", name: "Legend" },
  { level: 5, code: "megastriker", name: "Megastriker" }
];

const CANONICAL_BY_CODE = RANK_ORDER.reduce(function (acc, item) {
  acc[item.code] = item;
  return acc;
}, {});

function normalizeCompetitiveRank(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return null;
  }

  if (/^[1-5]$/.test(raw)) {
    const level = Number(raw);
    return RANK_ORDER.find(function (item) {
      return item.level === level;
    }) || null;
  }

  const cleaned = raw.replace(/[^a-z0-9]/g, "");
  if (CANONICAL_BY_CODE[cleaned]) {
    return CANONICAL_BY_CODE[cleaned];
  }

  if (cleaned === "mega" || cleaned === "megastriker") {
    return CANONICAL_BY_CODE.megastriker;
  }

  return null;
}

module.exports = {
  RANK_ORDER,
  normalizeCompetitiveRank
};
