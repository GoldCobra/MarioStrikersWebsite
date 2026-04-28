(function () {
  "use strict";

  var SESSION_CACHE_PREFIX = "leaderboardRows::";
  var SESSION_CACHE_TTL_MS = 5 * 60 * 1000;
  var ROW_ASSET_FILES = ["normal-rank.png", "rank1.png", "rank2.png", "rank3.png"];
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
          return preloadImage(prefix + "/assets/nav-buttons/sub/" + icon);
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

  function toRowClass(rank) {
    var safeRank = Number(rank);
    if (safeRank === 1) {
      return "lb-row lb-row-rank-1";
    }
    if (safeRank === 2) {
      return "lb-row lb-row-rank-2";
    }
    if (safeRank === 3) {
      return "lb-row lb-row-rank-3";
    }
    return "lb-row";
  }

  function normalizeRows(rows) {
    if (!Array.isArray(rows)) {
      return [];
    }
    return rows
      .map(function (row, index) {
        var rank = Number(row && row.rank);
        var rating = Number(row && row.rating);
        var displayName = String(row && (row.display_name || row.player || row.name) || "").trim();
        if (!displayName || !Number.isFinite(rating)) {
          return null;
        }
        return {
          rank: Number.isFinite(rank) && rank > 0 ? Math.floor(rank) : index + 1,
          display_name: displayName,
          rating: rating
        };
      })
      .filter(Boolean);
  }

  function buildRowsHtml(rows) {
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
      return [
        '<article class="', toRowClass(row.rank), '" role="listitem">',
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

  function renderLoadingState(mount) {
    if (!mount) {
      return;
    }
    mount.innerHTML = '<p class="leaderboard-empty loading-note">Loading...</p>';
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
      var response = await fetch(apiUrl, { headers: { Accept: "application/json" } });
      if (!response.ok) {
        throw new Error("Leaderboard request failed.");
      }
      var payload = await response.json();
      var normalized = normalizeRows(payload && payload.rows);
      if (normalized.length > 0) {
        writeCachedRows(tabKey, normalized);
        return {
          rows: normalized,
          source: "network"
        };
      }
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
      emptyEl.hidden = false;
      return;
    }

    listEl.innerHTML = buildRowsHtml(rows);
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
          listEl.innerHTML = buildRowsHtml(refreshed.rows);
          emptyEl.hidden = refreshed.rows.length > 0;
        })
        .catch(function () {
          // Silent fallback: Cache-Daten bleiben sichtbar.
        });
    }
  }

  function getCurrentPageFilename() {
    return String(window.location.pathname || "").split("/").pop().toLowerCase();
  }

  function getPathPrefix() {
    var path = String(window.location.pathname || "").toLowerCase();
    return path.indexOf("/pages/") !== -1 ? ".." : ".";
  }

  function isTabsParentView() {
    var search = window.location && window.location.search ? window.location.search : "";
    if (!search) {
      return false;
    }
    var params = new URLSearchParams(search);
    return params.get("tabs") === "none";
  }

  function buildTabInnerMarkup(tab, prefix) {
    var icon = tab && tab.icon ? String(tab.icon) : "";
    if (!icon) {
      return '<span class="leaderboard-tab-label">' + escapeHtml(formatTabLabel(tab.label)) + "</span>";
    }

    return [
      '<span class="leaderboard-tab-inner">',
      '<img class="leaderboard-tab-ball" src="', prefix, "/assets/nav-buttons/sub/", escapeHtml(icon), '" alt="" aria-hidden="true">',
      '<span class="leaderboard-tab-label">', escapeHtml(formatTabLabel(tab.label)), "</span>",
      "</span>"
    ].join("");
  }

  function buildTabsHtml(config, pageKey, currentFile, prefix, suppressAutoActive) {
    return config.tabs.map(function (tab, index) {
      var tabId = pageKey + "-tab-" + tab.key;
      var tabHref = tab.href ? String(tab.href) : "";
      var isActive = !suppressAutoActive && tabHref.toLowerCase() === currentFile;
      if (!suppressAutoActive && !currentFile && index === 0) {
        isActive = true;
      }
      return [
        '<button id="', tabId, '" class="global-tab leaderboard-ball-tab', isActive ? " is-active" : "", '" type="button" role="tab" aria-selected="', isActive ? "true" : "false", '" data-lb-tab="', tab.key, '" data-lb-href="', escapeHtml(tabHref), '">',
        buildTabInnerMarkup(tab, prefix),
        "</button>"
      ].join("");
    }).join("");
  }

  function buildShellHtml(config, pageKey, currentFile, prefix, suppressAutoActive) {
    return [
      '<section class="global-tabs-shell leaderboard-tabs-shell" aria-label="', escapeHtml(config.title || "Leaderboards"), '">',
      '<div class="global-tabs-list" role="tablist" aria-label="', escapeHtml(config.tabAriaLabel || "Leaderboard modes"), '">',
      buildTabsHtml(config, pageKey, currentFile, prefix, suppressAutoActive),
      "</div>",
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
        button.setAttribute("aria-selected", isActive ? "true" : "false");
        button.tabIndex = isActive ? 0 : -1;
      });

      if (tabsController) {
        tabsController.sync();
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
          var tabHref = String(button.getAttribute("data-lb-href") || "").toLowerCase();
          var suppressAutoActive = isTabsParentView();

          if (tabHref && (tabHref !== currentFile || suppressAutoActive)) {
            window.location.href = tabHref;
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
          setActiveTab(nextButton.getAttribute("data-lb-tab"));
        });
      });
    }

    return {
      bindEvents: bindEvents,
      setActiveTab: setActiveTab
    };
  }

  function prefetchAllLeaderboardTabs(config, activeKey) {
    if (!config || !Array.isArray(config.tabs) || config.tabs.length === 0) {
      return;
    }

    config.tabs.forEach(function (tab) {
      if (!tab || !tab.key || tab.key === activeKey) {
        return;
      }

      fetchLeaderboardRows(tab.key, { allowCache: true })
        .then(function (result) {
          if (result && result.source === "cache") {
            return fetchLeaderboardRows(tab.key, { allowCache: false, forceNetwork: true });
          }
          return null;
        })
        .catch(function () {
          // Prefetch darf das UI nie stören.
        });
    });
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

    renderLoadingState(mount);

    var currentFile = getCurrentPageFilename();
    var prefix = getPathPrefix();
    var pageKey = getPageKey();
    var suppressAutoActive = isTabsParentView();
    preloadLeaderboardRowAssets(prefix);
    var tabWarmupPromise = preloadLeaderboardTabIcons(prefix, config);
    await waitForWarmup(tabWarmupPromise, 140);
    mount.innerHTML = buildShellHtml(config, pageKey, currentFile, prefix, suppressAutoActive);

    var controller = createController(function (activeKey) {
      renderLeaderboardRows(activeKey);
    });
    if (!controller) {
      return;
    }

    controller.bindEvents();
    var activeTab = null;
    for (var i = 0; i < config.tabs.length; i += 1) {
      var href = String(config.tabs[i].href || "").toLowerCase();
      if (href === currentFile) {
        activeTab = config.tabs[i];
        break;
      }
    }
    var initialActiveKey = (activeTab && activeTab.key) || config.tabs[0].key;
    if (!suppressAutoActive) {
      controller.setActiveTab(initialActiveKey);
    }

    prefetchAllLeaderboardTabs(config, initialActiveKey);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initLeaderboardsPage);
    return;
  }

  initLeaderboardsPage();
})();
