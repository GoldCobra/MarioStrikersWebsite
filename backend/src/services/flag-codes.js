function normalizeText(value) {
  return String(value || "").trim();
}

const FLAG_CODE_ALIASES = Object.freeze({
  "uk": "gb",
  "great britain": "gb",
  "greatbritain": "gb",
  "united kingdom": "gb",
  "unitedkingdom": "gb",
  "england": "gb-eng",
  "eng": "gb-eng",
  "en": "gb-eng",
  "gb-eng": "gb-eng",
  "gbeng": "gb-eng",
  "gb-en": "gb-eng",
  "gben": "gb-eng",
  "scotland": "gb-sct",
  "sct": "gb-sct",
  "sco": "gb-sct",
  "gb-sct": "gb-sct",
  "gbsct": "gb-sct",
  "gb-sco": "gb-sct",
  "gbsco": "gb-sct",
  "wales": "gb-wls",
  "wls": "gb-wls",
  "wal": "gb-wls",
  "gb-wls": "gb-wls",
  "gbwls": "gb-wls",
  "gb-wal": "gb-wls",
  "gbwal": "gb-wls",
  "northern ireland": "gb-nir",
  "northernireland": "gb-nir",
  "nir": "gb-nir",
  "gb-nir": "gb-nir",
  "gbnir": "gb-nir",
  "gb-ni": "gb-nir",
  "gbni": "gb-nir"
});

function normalizeCountryCode(value) {
  const raw = normalizeText(value).toLowerCase().replace(/[_\u2013\u2014]/g, "-");
  if (!raw) {
    return "";
  }

  const spaced = raw.replace(/[-\s]+/g, " ").trim();
  const dashed = spaced.replace(/\s+/g, "-");
  const compact = spaced.replace(/\s+/g, "");
  const alias = FLAG_CODE_ALIASES[raw]
    || FLAG_CODE_ALIASES[spaced]
    || FLAG_CODE_ALIASES[dashed]
    || FLAG_CODE_ALIASES[compact];
  if (alias) {
    return alias;
  }

  if (/^[a-z]{2}$/.test(dashed)) {
    return dashed;
  }
  if (/^gb-(eng|wls|sct|nir)$/.test(dashed)) {
    return dashed;
  }
  return "";
}

module.exports = {
  FLAG_CODE_ALIASES,
  normalizeCountryCode
};
