// Shared country-flag helpers exposed as window.MSCFlags.
//
// FLAG_CODE_ALIASES + normalizeCountryCode were previously copy-pasted
// (byte-identical) into players-engine.js, profile-page.js and
// msbl-clubs-engine.js. This is the single source of truth. It must be loaded
// (defer) BEFORE any of those engines on every page that uses them; consumers
// degrade gracefully (no flag) if it is somehow absent.
(function () {
  "use strict";

  var FLAG_CODE_ALIASES = Object.freeze({
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

  function normalizeCountryCode(countryCode) {
    var raw = String(countryCode || "").trim().toLowerCase().replace(/[_–—]/g, "-");
    if (!raw) {
      return "";
    }

    var spaced = raw.replace(/[-\s]+/g, " ").trim();
    var dashed = spaced.replace(/\s+/g, "-");
    var compact = spaced.replace(/\s+/g, "");
    var alias = FLAG_CODE_ALIASES[raw] || FLAG_CODE_ALIASES[spaced] || FLAG_CODE_ALIASES[dashed] || FLAG_CODE_ALIASES[compact];
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

  window.MSCFlags = Object.freeze({
    FLAG_CODE_ALIASES: FLAG_CODE_ALIASES,
    normalizeCountryCode: normalizeCountryCode
  });
})();
