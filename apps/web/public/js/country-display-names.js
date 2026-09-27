(function () {
  "use strict";

  var COUNTRY_NAME_OVERRIDES = Object.freeze({
    "gb-eng": "England",
    "gb-wls": "Wales",
    "gb-sct": "Scotland",
    "gb-nir": "Northern Ireland",
    "xk": "Kosovo"
  });

  var regionNames = null;
  var regionNamesInitialized = false;

  function normalizeCountryCode(countryCode) {
    return String(countryCode || "").trim().toLowerCase().replace(/[_\u2013\u2014]/g, "-");
  }

  function getRegionNames() {
    if (regionNamesInitialized) {
      return regionNames;
    }
    regionNamesInitialized = true;
    if (!window.Intl || typeof window.Intl.DisplayNames !== "function") {
      return null;
    }
    try {
      regionNames = new window.Intl.DisplayNames(["en"], { type: "region" });
    } catch (_error) {
      regionNames = null;
    }
    return regionNames;
  }

  function getCountryDisplayName(countryCode) {
    var code = normalizeCountryCode(countryCode);
    var override = COUNTRY_NAME_OVERRIDES[code];
    if (override) {
      return override;
    }
    if (!/^[a-z]{2}$/.test(code)) {
      return "";
    }

    var regionCode = code.toUpperCase();
    var names = getRegionNames();
    var displayName = names && names.of(regionCode);
    if (!displayName || displayName === regionCode) {
      return "";
    }
    return String(displayName);
  }

  window.MSCCountryDisplayNames = Object.freeze({
    getCountryDisplayName: getCountryDisplayName
  });
})();
