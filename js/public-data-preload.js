(function () {
  "use strict";

  var requests = Object.create(null);
  var PAGE_ENDPOINTS = {
    players: "/api/players",
    "msbl-striker-clubs": "/api/clubs/msbl",
    "msbl-elo1v1": "/api/leaderboards/msbl/elo1v1?limit=100&offset=0",
    "msbl-elo2v2": "/api/leaderboards/msbl/elo2v2?limit=100&offset=0",
    "msbl-whr": "/api/leaderboards/msbl/whr?limit=100&offset=0",
    "msc-elo1v1": "/api/leaderboards/msc/elo1v1?limit=100&offset=0",
    "msc-whr": "/api/leaderboards/msc/whr?limit=100&offset=0",
    "sms-elo1v1": "/api/leaderboards/sms/elo1v1?limit=100&offset=0",
    "sms-whr": "/api/leaderboards/sms/whr?limit=100&offset=0"
  };

  function getApiBase() {
    var runtime = window.APP_RUNTIME_CONFIG || {};
    var base = String(runtime.leaderboardsApiBase || "").trim();
    if (!base) {
      return "";
    }
    return base.replace(/\/+$/, "");
  }

  function toRequestUrl(url) {
    var raw = String(url || "").trim();
    if (!raw) {
      return "";
    }
    if (/^https?:\/\//i.test(raw)) {
      return raw;
    }
    return getApiBase() + (raw.charAt(0) === "/" ? raw : "/" + raw);
  }

  function fetchJson(url) {
    var requestUrl = toRequestUrl(url);
    if (!requestUrl) {
      return Promise.reject(new Error("Missing public data URL."));
    }

    if (!requests[requestUrl]) {
      requests[requestUrl] = fetch(requestUrl, {
        headers: { Accept: "application/json" }
      }).then(function (response) {
        if (!response.ok) {
          throw new Error("Public data request failed.");
        }
        return response.json();
      }).then(function (data) {
        delete requests[requestUrl];
        return data;
      }).catch(function (error) {
        delete requests[requestUrl];
        throw error;
      });
    }

    return requests[requestUrl];
  }

  function getPageKey() {
    var body = document.body;
    return body ? String(body.getAttribute("data-page") || "").trim().toLowerCase() : "";
  }

  function preloadCurrentPage() {
    var endpoint = PAGE_ENDPOINTS[getPageKey()];
    if (!endpoint) {
      return null;
    }
    return fetchJson(endpoint).catch(function () {
      return null;
    });
  }

  window.PublicDataPreload = {
    fetchJson: fetchJson,
    preloadCurrentPage: preloadCurrentPage
  };

  preloadCurrentPage();
})();
