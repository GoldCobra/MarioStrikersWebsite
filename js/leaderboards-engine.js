(function () {
  "use strict";

  var SESSION_CACHE_PREFIX = "leaderboardRows:v3::";
  var SESSION_CACHE_TTL_MS = 5 * 60 * 1000;
  var RANK_ICON_ASSET_VERSION = "20260608-rank-crop-v1";
  var ROW_ASSET_FILES = ["normal-rank.png", "rank1.png", "rank2.png", "rank3.png"];
  var COMPETITIVE_RANK_ICON_BY_NUMBER = {
    1: "1-bronze-I.png",
    2: "1-bronze-II.png",
    3: "1-bronze-III.png",
    4: "2-silver-I.png",
    5: "2-silver-II.png",
    6: "2-silver-III.png",
    7: "3-gold-I.png",
    8: "3-gold-II.png",
    9: "3-gold-III.png",
    10: "4-platinum-I.png",
    11: "4-platinum-II.png",
    12: "4-platinum-III.png",
    13: "5-diamond-I.png",
    14: "5-diamond-II.png",
    15: "5-diamond-III.png",
    16: "6-master-I.png",
    17: "6-master-II.png",
    18: "6-master-III.png",
    19: "7-strikerstitan-b.png"
  };
  var COMPETITIVE_RANK_ICON_BY_KEY = {
    bronzei: "1-bronze-I.png",
    bronze1: "1-bronze-I.png",
    bronzeii: "1-bronze-II.png",
    bronze2: "1-bronze-II.png",
    bronzeiii: "1-bronze-III.png",
    bronze3: "1-bronze-III.png",
    silveri: "2-silver-I.png",
    silver1: "2-silver-I.png",
    silverii: "2-silver-II.png",
    silver2: "2-silver-II.png",
    silveriii: "2-silver-III.png",
    silver3: "2-silver-III.png",
    goldi: "3-gold-I.png",
    gold1: "3-gold-I.png",
    goldii: "3-gold-II.png",
    gold2: "3-gold-II.png",
    goldiii: "3-gold-III.png",
    gold3: "3-gold-III.png",
    platinumi: "4-platinum-I.png",
    platinum1: "4-platinum-I.png",
    platinumii: "4-platinum-II.png",
    platinum2: "4-platinum-II.png",
    platinumiii: "4-platinum-III.png",
    platinum3: "4-platinum-III.png",
    diamondi: "5-diamond-I.png",
    diamond1: "5-diamond-I.png",
    diamondii: "5-diamond-II.png",
    diamond2: "5-diamond-II.png",
    diamondiii: "5-diamond-III.png",
    diamond3: "5-diamond-III.png",
    masteri: "6-master-I.png",
    master1: "6-master-I.png",
    masterii: "6-master-II.png",
    master2: "6-master-II.png",
    masteriii: "6-master-III.png",
    master3: "6-master-III.png",
    strikerstitan: "7-strikerstitan-b.png",
    titan: "7-strikerstitan-b.png"
  };
  var activeRenderRequestId = 0;
  var rowAssetsPreloadPromise = null;
  var tabIconsPreloadPromise = null;

  var FALLBACK_ROWS = [
    { rank: 1, display_name: "Romomo", rating: 1992 },
    { rank: 2, display_name: "Virtue", rating: 1984 },
    { rank: 3, display_name: "Zesty", rating: 1940 },
    { rank: 4, display_name: "Jbangsness", rating: 1779 },
    { rank: 5, display_name: "Ink", rating: 1681 },
    { rank: 6, display_name: "SaMuRaI7", rating: 1661 },
    { rank: 7, display_name: "J", rating: 1644 },
    { rank: 8, display_name: "Xshadow", rating: 1626 },
    { rank: 9, display_name: "NukA67", rating: 1528 },
    { rank: 10, display_name: "karlosjr", rating: 1477 }
  ];

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatTabLabel(label) {
    return String(label || "")
      .toUpperCase()
      .replace(/(\d)V(\d)/g, "$1v$2");
  }

  function getPageKey() {
    var body = document.body;
    return body ? String(body.getAttribute("data-page") || "").toLowerCase() : "";
  }

  function getPageConfig() {
    var config = window.LEADERBOARDS_CONFIG || {};
    return config[getPageKey()] || null;
  }

  function getApiBase() {
    var runtime = window.APP_RUNTIME_CONFIG || {};
    var base = String(runtime.leaderboardsApiBase || "").trim();
    if (!base) {
      return "";
    }
    return base.replace(/\/+$/, "");
  }

  function fetchJson(url) {
    if (window.PublicDataPreload && typeof window.PublicDataPreload.fetchJson === "function") {
      return window.PublicDataPreload.fetchJson(url);
    }

    return fetch(url, {
      headers: { Accept: "application/json" }
    }).then(function (response) {
      if (!response.ok) {
        throw new Error("Leaderboard request failed.");
      }
      return response.json();
    });
  }

  function parseGameAndMode(tabKey) {
    var key = String(tabKey || "").toLowerCase();
    var firstDash = key.indexOf("-");
    if (firstDash <= 0 || firstDash >= key.length - 1) {
      return null;
    }

    return {
      game: key.slice(0, firstDash),
      mode: key.slice(firstDash + 1)
    };
  }

  function preloadImage(src) {
    return new Promise(function (resolve) {
      var done = false;
      var image = new Image();

      function finish() {
        if (done) {
          return;
        }
        done = true;
        resolve();
      }

      image.onload = finish;
      image.onerror = finish;
      image.src = src;

      if (image.complete) {
        finish();
      }
    });
  }

  function toModernUiAssetPath(src) {
    return String(src || "").replace(/\.png$/i, ".webp");
  }

  function preloadLeaderboardRowAssets(prefix) {
    if (rowAssetsPreloadPromise) {
      return rowAssetsPreloadPromise;
    }

    rowAssetsPreloadPromise = Promise.all(
      ROW_ASSET_FILES.map(function (fileName) {
        return preloadImage(prefix + "/assets/leaderboards/" + fileName);
      })
    )
      .catch(function () {
        // Asset-Preload ist best effort und darf Rendering nicht blockieren.
      });

    return rowAssetsPreloadPromise;
  }

  function preloadLeaderboardTabIcons(prefix, config) {
    if (tabIconsPreloadPromise) {
      return tabIconsPreloadPromise;
    }

    var icons = [];
    if (config && Array.isArray(config.tabs)) {
      config.tabs.forEach(function (tab) {
        if (tab && tab.icon) {
          icons.push(String(tab.icon));
        }
      });
    }

    if (icons.length === 0) {
      tabIconsPreloadPromise = Promise.resolve();
      return tabIconsPreloadPromise;
    }

    var seen = Object.create(null);
    tabIconsPreloadPromise = Promise.all(
      icons
        .filter(function (icon) {
          if (!icon || seen[icon]) {
            return false;
          }
          seen[icon] = true;
          return true;
        })
        .map(function (icon) {
          return preloadImage(prefix + "/assets/nav-buttons/sub/" + toModernUiAssetPath(icon));
        })
    )
      .catch(function () {
        // Tab-Icon-Preload ist best effort und darf Rendering nicht blockieren.
      });

    return tabIconsPreloadPromise;
  }

  function waitForWarmup(promise, timeoutMs) {
    var timeout = Number(timeoutMs);
    if (!promise || !Number.isFinite(timeout) || timeout <= 0) {
      return Promise.resolve();
    }
    return Promise.race([
      promise,
      new Promise(function (resolve) {
        setTimeout(resolve, timeout);
      })
    ]);
  }

  function getSessionCacheKey(tabKey) {
    return SESSION_CACHE_PREFIX + String(tabKey || "");
  }

  function readCachedRows(tabKey) {
    try {
      if (!window.sessionStorage) {
        return null;
      }

      var raw = window.sessionStorage.getItem(getSessionCacheKey(tabKey));
      if (!raw) {
        return null;
      }

      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.rows)) {
        return null;
      }

      var timestamp = Number(parsed.timestamp || 0);
      if (!Number.isFinite(timestamp) || Date.now() - timestamp > SESSION_CACHE_TTL_MS) {
        return null;
      }

      var rows = normalizeRows(parsed.rows);
      return rows.length ? rows : null;
    } catch (_error) {
      return null;
    }
  }

  function writeCachedRows(tabKey, rows) {
    try {
      if (!window.sessionStorage || !Array.isArray(rows) || rows.length === 0) {
        return;
      }

      window.sessionStorage.setItem(
        getSessionCacheKey(tabKey),
        JSON.stringify({
          timestamp: Date.now(),
          rows: rows
        })
      );
    } catch (_error) {
      // Cache ist optional. Fehler dürfen das Rendering nicht beeinflussen.
    }
  }

  function formatRating(value) {
    var rating = Number(value);
    if (!Number.isFinite(rating)) {
      return "0";
    }
    if (Math.floor(rating) === rating) {
      return String(rating);
    }
    return rating.toFixed(2).replace(/\.?0+$/, "");
  }

  function toRowClass(rank, hasRankIcon) {
    var safeRank = Number(rank);
    var className = "lb-row";
    if (safeRank === 1) {
      className += " lb-row-rank-1";
    } else if (safeRank === 2) {
      className += " lb-row-rank-2";
    } else if (safeRank === 3) {
      className += " lb-row-rank-3";
    }

    if (hasRankIcon) {
      className += " lb-row-has-rank-icon";
    }
    return className;
  }

  function normalizeCompetitiveRankKey(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function getCompetitiveRankIconFile(row) {
    var rankNumber = Number(row && row.rank_number);
    if (Number.isFinite(rankNumber) && COMPETITIVE_RANK_ICON_BY_NUMBER[Math.floor(rankNumber)]) {
      return COMPETITIVE_RANK_ICON_BY_NUMBER[Math.floor(rankNumber)];
    }

    var key = normalizeCompetitiveRankKey(row && row.competitive_rank);
    return key ? COMPETITIVE_RANK_ICON_BY_KEY[key] || "" : "";
  }

  function buildCompetitiveRankIconMarkup(row, prefix) {
    var fileName = getCompetitiveRankIconFile(row);
    if (!fileName) {
      return "";
    }

    return [
      '<img class="lb-rank-icon" src="',
      escapeHtml(prefix + "/assets/leaderboards/rankicons/" + fileName + "?v=" + RANK_ICON_ASSET_VERSION),
      '" alt="" aria-hidden="true" loading="lazy">'
    ].join("");
  }

  function normalizeRows(rows) {
    if (!Array.isArray(rows)) {
      return [];
    }
    return rows
      .map(function (row, index) {
        var rank = Number(row && row.rank);
        var rating = Number(row && row.rating);
        var rankNumber = Number(row && row.rank_number);
        var displayName = String(row && (row.display_name || row.player || row.name) || "").trim();
        var competitiveRank = String(row && (row.competitive_rank || row.competitiveRank || row.rank_name || row.rankName) || "").trim();
        if (!displayName || !Number.isFinite(rating)) {
          return null;
        }
        return {
          rank: Number.isFinite(rank) && rank > 0 ? Math.floor(rank) : index + 1,
          display_name: displayName,
          rating: rating,
          rank_number: Number.isFinite(rankNumber) && rankNumber > 0 ? Math.floor(rankNumber) : 0,
          competitive_rank: competitiveRank
        };
      })
      .filter(Boolean);
  }

  function buildRowsHtml(rows, prefix) {
    function buildRankMarkup(rank) {
      if (Number(rank) === 1) {
        return [
          '<span class="lb-rank-1">',
          '<svg class="lb-rank-1-svg" viewBox="0 0 100 120" aria-hidden="true" focusable="false">',
          '<defs><linearGradient id="lb-rank1-grad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="120">',
          '<stop offset="0%" stop-color="#fff45a"></stop>',
          '<stop offset="52%" stop-color="#ffc800"></stop>',
          '<stop offset="100%" stop-color="#9a5b00"></stop>',
          '</linearGradient></defs>',
          '<text class="lb-rank-1-svg-stroke" x="50" y="50%" text-anchor="middle">1</text>',
          '<text class="lb-rank-1-svg-fill" x="50" y="50%" text-anchor="middle" fill="url(#lb-rank1-grad)">1</text>',
          '</svg>',
          '</span>'
        ].join("");
      }
      return '<span class="lb-rank">' + escapeHtml(String(rank)) + "</span>";
    }

    return rows.map(function (row) {
      var rankIconMarkup = buildCompetitiveRankIconMarkup(row, prefix || ".");
      return [
        '<article class="', toRowClass(row.rank, !!rankIconMarkup), '" role="listitem">',
        rankIconMarkup,
        '<div class="lb-inner-frame">',
        '<div class="lb-rank-cell">', buildRankMarkup(row.rank), "</div>",
        '<div class="lb-player">', escapeHtml(row.display_name), "</div>",
        '<div class="lb-points">', escapeHtml(formatRating(row.rating)), "</div>",
        "</div>",
        "</article>"
      ].join("");
    }).join("");
  }

  function buildLeaderboardBlockHtml() {
    return [
      '<section class="leaderboard-block" aria-label="Leaderboard rows">',
      '<div id="leaderboard-list" class="leaderboard-list" role="list"></div>',
      '<p id="leaderboard-empty" class="leaderboard-empty" hidden>No ratings available.</p>',
      "</section>"
    ].join("");
  }

  async function fetchLeaderboardRows(tabKey, options) {
    var opts = options || {};
    var allowCache = opts.allowCache !== false;
    var forceNetwork = opts.forceNetwork === true;
    var cachedRows = allowCache ? readCachedRows(tabKey) : null;

    if (cachedRows && !forceNetwork) {
      return {
        rows: cachedRows,
        source: "cache"
      };
    }

    var gameAndMode = parseGameAndMode(tabKey);
    if (!gameAndMode) {
      return {
        rows: FALLBACK_ROWS.slice(),
        source: "fallback"
      };
    }

    var base = getApiBase();
    var apiUrl = (base || "") + "/api/leaderboards/" + gameAndMode.game + "/" + gameAndMode.mode + "?limit=100&offset=0";

    try {
      var payload = await fetchJson(apiUrl);
      var normalized = normalizeRows(payload && payload.rows);
      if (normalized.length > 0) {
        writeCachedRows(tabKey, normalized);
      }
      return {
        rows: normalized,
        source: "network"
      };
    } catch (_error) {
      // Falls Backend/API nicht erreichbar ist, zeigen wir stabile Fallback-Daten.
    }

    if (cachedRows) {
      return {
        rows: cachedRows,
        source: "stale-cache"
      };
    }

    return {
      rows: FALLBACK_ROWS.slice(),
      source: "fallback"
    };
  }

  async function renderLeaderboardRows(tabKey) {
    var requestId = ++activeRenderRequestId;
    var listEl = document.getElementById("leaderboard-list");
    var emptyEl = document.getElementById("leaderboard-empty");
    var prefix = getPathPrefix();
    if (!listEl || !emptyEl) {
      return;
    }

    listEl.innerHTML = "";
    emptyEl.textContent = "Loading...";
    emptyEl.hidden = false;

    var primary = await fetchLeaderboardRows(tabKey, { allowCache: true });
    await (rowAssetsPreloadPromise || Promise.resolve());
    if (requestId !== activeRenderRequestId) {
      return;
    }

    var rows = primary.rows;
    if (!rows.length) {
      listEl.innerHTML = "";
      emptyEl.textContent = "No ratings available.";
      emptyEl.hidden = false;
      return;
    }

    listEl.innerHTML = buildRowsHtml(rows, prefix);
    emptyEl.hidden = true;

    if (primary.source === "cache") {
      fetchLeaderboardRows(tabKey, { allowCache: false, forceNetwork: true })
        .then(function (refreshed) {
          if (!refreshed || refreshed.source !== "network") {
            return;
          }
          if (requestId !== activeRenderRequestId) {
            return;
          }
          listEl.innerHTML = buildRowsHtml(refreshed.rows, prefix);
          emptyEl.hidden = refreshed.rows.length > 0;
        })
        .catch(function () {
          // Silent fallback: Cache-Daten bleiben sichtbar.
        });
    }
  }

  function getCurrentPageFilename() {
    var body = document.body;
    var byDataset = body ? String(body.getAttribute("data-page") || "").trim().toLowerCase() : "";
    if (byDataset) {
      return byDataset.replace(/\.html$/, "");
    }

    var path = String(window.location.pathname || "").toLowerCase();
    if (!path || path === "/") {
      return "index";
    }

    return String(path.replace(/\/+$/, "").split("/").pop() || "")
      .replace(/\.html$/, "")
      .toLowerCase();
  }

  function getPathPrefix() {
    var path = String(window.location.pathname || "").toLowerCase();
    return path.indexOf("/pages/") !== -1 ? ".." : ".";
  }

  function toPageHref(prefix, rawTarget) {
    void prefix;
    var normalized = String(rawTarget || "")
      .trim()
      .toLowerCase()
      .replace(/^\/*(?:pages\/)?/, "")
      .replace(/\/+$/, "")
      .replace(/\.html$/, "");

    if (!normalized || normalized === "index") {
      return "/";
    }

    return "/" + normalized;
  }

  function buildTabInnerMarkup(tab, prefix) {
    var icon = tab && tab.icon ? String(tab.icon) : "";
    if (!icon) {
      return '<span class="leaderboard-tab-label">' + escapeHtml(formatTabLabel(tab.label)) + "</span>";
    }

    var iconFallbackSrc = prefix + "/assets/nav-buttons/sub/" + icon;
    var iconSrc = prefix + "/assets/nav-buttons/sub/" + toModernUiAssetPath(icon);

    return [
      '<span class="leaderboard-tab-inner">',
      '<img class="leaderboard-tab-ball" src="', escapeHtml(iconSrc), '" alt="" aria-hidden="true" onerror="this.onerror=null;this.src=\'', escapeHtml(iconFallbackSrc), '\'">',
      '<span class="leaderboard-tab-label">', escapeHtml(formatTabLabel(tab.label)), "</span>",
      "</span>"
    ].join("");
  }

  function buildTabsHtml(config, pageKey, currentFile, prefix) {
    return config.tabs.map(function (tab) {
      var tabId = pageKey + "-tab-" + tab.key;
      var tabHref = toPageHref(prefix, tab.href || tab.key);
      var tabRouteKey = String(tab.key || "")
        .trim()
        .toLowerCase()
        .replace(/\.html$/, "");
      var isActive = tabRouteKey === currentFile;
      return [
        '<a id="', tabId, '" class="global-tab leaderboard-ball-tab', isActive ? " is-active" : "", '" href="', escapeHtml(tabHref), '" data-lb-tab="', tab.key, '" data-lb-href="', escapeHtml(tabHref), '"',
        isActive ? ' aria-current="page"' : "",
        ">",
        buildTabInnerMarkup(tab, prefix),
        "</a>"
      ].join("");
    }).join("");
  }

  function buildShellHtml(config, pageKey, currentFile, prefix) {
    return [
      '<section class="global-tabs-shell leaderboard-tabs-shell" aria-label="', escapeHtml(config.title || "Leaderboards"), '">',
      '<nav class="global-tabs-list" aria-label="', escapeHtml(config.tabAriaLabel || "Leaderboard modes"), '">',
      buildTabsHtml(config, pageKey, currentFile, prefix),
      "</nav>",
      "</section>",
      buildLeaderboardBlockHtml()
    ].join("");
  }

  function createController(onActiveTabChange) {
    var shell = document.querySelector(".global-tabs-shell");
    var tabsRoot = document.querySelector(".global-tabs-list");
    var tabButtons = Array.prototype.slice.call(document.querySelectorAll("[data-lb-tab]"));

    if (!shell || !tabsRoot || tabButtons.length === 0) {
      return null;
    }

    var tabsController = null;
    if (window.GlobalTabsEngine && typeof window.GlobalTabsEngine.initTabsGroup === "function") {
      tabsController = window.GlobalTabsEngine.initTabsGroup({
        shell: shell,
        tabsRoot: tabsRoot,
        tabSelector: ".global-tab",
        activeSelector: ".global-tab.is-active"
      });
    }

    function setActiveTab(tabKey) {
      tabButtons.forEach(function (button) {
        var isActive = button.getAttribute("data-lb-tab") === tabKey;
        button.classList.toggle("is-active", isActive);
        if (isActive) {
          button.setAttribute("aria-current", "page");
        } else {
          button.removeAttribute("aria-current");
        }
        button.tabIndex = isActive ? 0 : -1;
      });

      if (tabsController) {
        tabsController.sync();
        if (typeof tabsController.revealActiveTab === "function") {
          tabsController.revealActiveTab();
        }
      }

      if (typeof onActiveTabChange === "function") {
        onActiveTabChange(tabKey);
      }
    }

    function bindEvents() {
      var currentFile = getCurrentPageFilename();

      tabButtons.forEach(function (button, index) {
        button.addEventListener("click", function (event) {
          var tabKey = button.getAttribute("data-lb-tab");
          if (tabKey !== currentFile) {
            return;
          }

          event.preventDefault();
          setActiveTab(tabKey);
        });

        button.addEventListener("keydown", function (event) {
          if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
            return;
          }

          event.preventDefault();
          var direction = event.key === "ArrowRight" ? 1 : -1;
          var nextIndex = (index + direction + tabButtons.length) % tabButtons.length;
          var nextButton = tabButtons[nextIndex];
          nextButton.focus();
        });
      });
    }

    return {
      bindEvents: bindEvents,
      setActiveTab: setActiveTab
    };
  }

  async function initLeaderboardsPage() {
    var config = getPageConfig();
    if (!config || !Array.isArray(config.tabs) || config.tabs.length === 0) {
      return;
    }

    var mount = document.getElementById("leaderboards-root");
    if (!mount) {
      return;
    }

    var currentFile = getCurrentPageFilename();
    var prefix = getPathPrefix();
    var pageKey = getPageKey();
    preloadLeaderboardRowAssets(prefix);
    var tabWarmupPromise = preloadLeaderboardTabIcons(prefix, config);
    await waitForWarmup(tabWarmupPromise, 140);
    mount.innerHTML = buildShellHtml(config, pageKey, currentFile, prefix);

    var controller = createController(function (activeKey) {
      renderLeaderboardRows(activeKey);
    });
    if (!controller) {
      return;
    }

    controller.bindEvents();
    var hasMatchedTab = config.tabs.some(function (tab) {
      return String(tab && tab.key || "").toLowerCase() === currentFile;
    });
    if (hasMatchedTab) {
      controller.setActiveTab(currentFile);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initLeaderboardsPage);
    return;
  }

  initLeaderboardsPage();
})();
