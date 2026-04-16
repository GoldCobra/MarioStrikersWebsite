(function () {
  "use strict";

  var ROW_CLASS_BY_RANK = {
    1: "lb-row lb-row-rank-1",
    2: "lb-row lb-row-rank-2",
    3: "lb-row lb-row-rank-3"
  };
  var SVG_NS = "http://www.w3.org/2000/svg";
  var OVERLAY_CLASS = "msbl-tabs-line-overlay";
  var LINE_THICKNESS = 3;
  var API_TIMEOUT_MS = 15000;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getPageKey() {
    var body = document.body;
    return body ? String(body.getAttribute("data-page") || "").toLowerCase() : "";
  }

  function getPageConfig() {
    var config = window.LEADERBOARDS_CONFIG || {};
    return config[getPageKey()] || null;
  }

  function getCurrentPageFilename() {
    return String(window.location.pathname || "").split("/").pop().toLowerCase();
  }

  function resolveApiBase() {
    var runtimeConfig = window.APP_RUNTIME_CONFIG || {};
    var fromRuntime = String(runtimeConfig.leaderboardsApiBase || "").trim();
    if (fromRuntime) {
      return fromRuntime.replace(/\/+$/, "");
    }

    var fromGlobal = String(window.LEADERBOARDS_API_BASE || "").trim();
    if (fromGlobal) {
      return fromGlobal.replace(/\/+$/, "");
    }

    return "";
  }

  function buildApiUrl(gameCode, modeCode, options) {
    var apiBase = resolveApiBase();
    var limit = Number(options && options.limit) > 0 ? Number(options.limit) : 200;
    var offset = Number(options && options.offset) > 0 ? Number(options.offset) : 0;
    var query = "?limit=" + encodeURIComponent(limit) + "&offset=" + encodeURIComponent(offset);
    return apiBase + "/api/leaderboards/" + encodeURIComponent(gameCode) + "/" + encodeURIComponent(modeCode) + query;
  }

  function fetchJsonWithTimeout(url, timeoutMs) {
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, timeoutMs);

    return fetch(url, { signal: controller.signal })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Request failed with status " + response.status);
        }
        return response.json();
      })
      .finally(function () {
        clearTimeout(timer);
      });
  }

  function normalizeApiRows(rows) {
    if (!Array.isArray(rows)) {
      return [];
    }

    return rows.map(function (row) {
      return {
        rank: Number(row.rank || 0) || 0,
        player: row.display_name || row.player || "Unknown",
        rating: Number(row.rating || 0) || 0
      };
    });
  }

  function renderRankGlyph(rank) {
    if (rank !== 1) {
      return [
        "<span class=\"lb-rank\">",
        String(rank),
        "</span>"
      ].join("");
    }

    return [
      "<span class=\"lb-rank lb-rank-svg-wrap\" aria-label=\"1\">",
      "<svg class=\"lb-rank-svg\" viewBox=\"0 0 120 140\" role=\"img\" aria-hidden=\"true\" focusable=\"false\" xmlns=\"http://www.w3.org/2000/svg\">",
      "<defs>",
      "<linearGradient id=\"rank1-base-grad\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">",
      "<stop offset=\"0%\" stop-color=\"#f6ea82\"/>",
      "<stop offset=\"50%\" stop-color=\"#d7bd22\"/>",
      "<stop offset=\"100%\" stop-color=\"#9b5200\"/>",
      "</linearGradient>",
      "<clipPath id=\"rank1-glyph-clip\">",
      "<text x=\"60\" y=\"114\" text-anchor=\"middle\" font-family=\"ITC Grizzly\" font-size=\"122\" font-weight=\"400\">1</text>",
      "</clipPath>",
      "<clipPath id=\"rank1-top-highlight-clip\">",
      "<polygon points=\"18,0 104,0 104,30 44,74 18,50\"/>",
      "</clipPath>",
      "<clipPath id=\"rank1-right-highlight-clip\">",
      "<rect x=\"70\" y=\"12\" width=\"34\" height=\"96\"/>",
      "</clipPath>",
      "</defs>",
      "<g transform=\"translate(-5 3)\">",
      "<text x=\"60\" y=\"114\" text-anchor=\"middle\" font-family=\"ITC Grizzly\" font-size=\"122\" font-weight=\"400\" fill=\"#000\" stroke=\"#000\" stroke-width=\"2\" vector-effect=\"non-scaling-stroke\" stroke-linejoin=\"round\" paint-order=\"stroke fill\">1</text>",
      "</g>",
      "<text x=\"60\" y=\"114\" text-anchor=\"middle\" font-family=\"ITC Grizzly\" font-size=\"122\" font-weight=\"400\" fill=\"url(#rank1-base-grad)\" stroke=\"#000\" stroke-width=\"2\" vector-effect=\"non-scaling-stroke\" stroke-linejoin=\"round\" paint-order=\"stroke fill\">1</text>",
      "<g clip-path=\"url(#rank1-glyph-clip)\" opacity=\"0.92\">",
      "<g clip-path=\"url(#rank1-top-highlight-clip)\">",
      "<text x=\"60\" y=\"114\" text-anchor=\"middle\" font-family=\"ITC Grizzly\" font-size=\"122\" font-weight=\"400\" fill=\"none\" stroke=\"#e4d484\" stroke-width=\"4\" vector-effect=\"non-scaling-stroke\" stroke-linejoin=\"round\" paint-order=\"stroke fill\">1</text>",
      "</g>",
      "<g clip-path=\"url(#rank1-right-highlight-clip)\">",
      "<text x=\"60\" y=\"114\" text-anchor=\"middle\" font-family=\"ITC Grizzly\" font-size=\"122\" font-weight=\"400\" fill=\"none\" stroke=\"#e4d484\" stroke-width=\"4\" vector-effect=\"non-scaling-stroke\" stroke-linejoin=\"round\" paint-order=\"stroke fill\">1</text>",
      "</g>",
      "</g>",
      "</svg>",
      "</span>"
    ].join("");
  }

  function getRowClassByRank(rank) {
    return ROW_CLASS_BY_RANK[rank] || "lb-row lb-row-rank-default";
  }

  function ensureTabsLineOverlay(tabsRoot) {
    var existing = tabsRoot.querySelector("." + OVERLAY_CLASS);
    if (existing) {
      return existing;
    }

    var overlay = document.createElementNS(SVG_NS, "svg");
    overlay.setAttribute("class", OVERLAY_CLASS);
    overlay.setAttribute("aria-hidden", "true");
    overlay.setAttribute("focusable", "false");
    overlay.setAttribute("preserveAspectRatio", "none");
    tabsRoot.appendChild(overlay);
    return overlay;
  }

  function buildLineRects(overlay, tabsWidth, tabsHeight, activeLeft, activeWidth, activeIndex, tabCount) {
    var overlayWidth = Math.max(1, tabsWidth);
    var overlayHeight = Math.max(1, tabsHeight);
    var activeX = Math.max(0, Math.min(overlayWidth, activeLeft));
    var activeW = Math.max(0, Math.min(overlayWidth - activeX, activeWidth));
    var activeRight = activeX + activeW;
    var topY = 0;
    var bottomY = Math.max(0, overlayHeight - LINE_THICKNESS);
    var leftBottomWidth = Math.max(0, activeX);
    var rightBottomWidth = Math.max(0, overlayWidth - activeRight);

    overlay.setAttribute("viewBox", "0 0 " + overlayWidth + " " + overlayHeight);
    overlay.setAttribute("width", String(overlayWidth));
    overlay.setAttribute("height", String(overlayHeight));
    overlay.setAttribute("shape-rendering", "crispEdges");

    var parts = [
      "<defs>",
      "<linearGradient id=\"msbl-tabs-line-gradient\" x1=\"0\" y1=\"0\" x2=\"" + overlayWidth + "\" y2=\"0\" gradientUnits=\"userSpaceOnUse\">",
      "<stop offset=\"0%\" stop-color=\"#b33a08\"/>",
      "<stop offset=\"50%\" stop-color=\"#c77603\"/>",
      "<stop offset=\"100%\" stop-color=\"#b33a08\"/>",
      "</linearGradient>",
      "</defs>"
    ];

    if (leftBottomWidth > 0) {
      parts.push(
        "<rect x=\"0\" y=\"" + bottomY + "\" width=\"" + leftBottomWidth + "\" height=\"" + LINE_THICKNESS + "\" fill=\"url(#msbl-tabs-line-gradient)\"/>"
      );
    }

    if (rightBottomWidth > 0) {
      parts.push(
        "<rect x=\"" + activeRight + "\" y=\"" + bottomY + "\" width=\"" + rightBottomWidth + "\" height=\"" + LINE_THICKNESS + "\" fill=\"url(#msbl-tabs-line-gradient)\"/>"
      );
    }

    if (activeW > 0) {
      var hasLeftEdge = activeIndex === 0;
      var hasRightEdge = activeIndex === tabCount - 1;

      parts.push(
        "<rect x=\"" + activeX + "\" y=\"" + topY + "\" width=\"" + activeW + "\" height=\"" + LINE_THICKNESS + "\" fill=\"url(#msbl-tabs-line-gradient)\"/>"
      );

      if (hasLeftEdge) {
        parts.push(
          "<rect x=\"" + activeX + "\" y=\"" + topY + "\" width=\"" + LINE_THICKNESS + "\" height=\"" + overlayHeight + "\" fill=\"url(#msbl-tabs-line-gradient)\"/>"
        );
      }

      if (hasRightEdge) {
        parts.push(
          "<rect x=\"" + (activeRight - LINE_THICKNESS) + "\" y=\"" + topY + "\" width=\"" + LINE_THICKNESS + "\" height=\"" + overlayHeight + "\" fill=\"url(#msbl-tabs-line-gradient)\"/>"
        );
      }
    }

    overlay.innerHTML = parts.join("");
  }

  function buildShellHtml(config, pageKey) {
    var tabsHtml = config.tabs.map(function (tab, index) {
      var tabId = pageKey + "-tab-" + tab.key;
      var isActive = index === 0;
      var tabHref = tab.href ? String(tab.href) : "";
      return [
        '<button id="', tabId, '" class="msbl-board-tab', isActive ? " is-active" : "", '" type="button" role="tab" aria-selected="', isActive ? "true" : "false", '" aria-controls="leaderboard-tab-panel" data-lb-tab="', tab.key, '" data-lb-href="', escapeHtml(tabHref), '">',
        escapeHtml(tab.label),
        "</button>"
      ].join("");
    }).join("");

    var firstTab = config.tabs[0];
    var firstTabId = pageKey + "-tab-" + firstTab.key;

    return [
      '<section class="msbl-leaderboards-shell" aria-label="', escapeHtml(config.title || "Leaderboards"), '">',
      '<div class="msbl-board-tabs" role="tablist" aria-label="', escapeHtml(config.tabAriaLabel || "Leaderboard modes"), '">',
      tabsHtml,
      "</div>",
      '<div id="leaderboard-tab-panel" class="msbl-board-panel" role="tabpanel" aria-labelledby="', firstTabId, '">',
      '<div class="lb-footer-headings" aria-hidden="true">',
      '<span class="lb-footer-rank">Rank</span>',
      '<span class="lb-footer-player">Player</span>',
      '<span class="lb-footer-rating">Rating</span>',
      "</div>",
      '<section class="leaderboard-block" aria-label="Leaderboard table">',
      '<div id="leaderboard-list" class="leaderboard-list"></div>',
      "</section>",
      "</div>",
      "</section>"
    ].join("");
  }

  function createController(config) {
    var tabsRoot = document.querySelector(".msbl-board-tabs");
    var panel = document.getElementById("leaderboard-tab-panel");
    var shell = document.querySelector(".msbl-leaderboards-shell");
    var rowsRoot = document.getElementById("leaderboard-list");
    var tabButtons = Array.prototype.slice.call(document.querySelectorAll("[data-lb-tab]"));
    var tabCache = {};
    var renderVersion = 0;

    if (!tabsRoot || !panel || !shell || !rowsRoot || tabButtons.length === 0) {
      return null;
    }

    function syncActiveTabGeometry() {
      var activeButton = tabsRoot.querySelector(".msbl-board-tab.is-active");
      if (!activeButton) {
        return;
      }

      var activeLeft = Math.max(0, Math.round(activeButton.offsetLeft - tabsRoot.scrollLeft));
      var activeWidth = Math.max(0, Math.round(activeButton.offsetWidth));
      var tabsWidth = Math.max(1, Math.round(tabsRoot.clientWidth));
      var tabsHeight = Math.max(1, Math.round(tabsRoot.clientHeight));
      var activeIndex = tabButtons.indexOf(activeButton);
      var tabCount = tabButtons.length;

      tabsRoot.style.setProperty("--active-left", activeLeft + "px");
      tabsRoot.style.setProperty("--active-width", activeWidth + "px");
      shell.style.setProperty("--active-left", activeLeft + "px");
      shell.style.setProperty("--active-width", activeWidth + "px");
      shell.style.setProperty("--msbl-tabs-render-height", tabsHeight + "px");

      buildLineRects(
        ensureTabsLineOverlay(tabsRoot),
        tabsWidth,
        tabsHeight,
        activeLeft,
        activeWidth,
        activeIndex,
        tabCount
      );
    }

    function renderRows(entries) {
      var safeRows = Array.isArray(entries) && entries.length > 0 ? entries : [];
      if (safeRows.length === 0) {
        rowsRoot.innerHTML = "<p class=\"leaderboard-empty\">No ratings available.</p>";
        return;
      }

      var hasPrecomputedRank = safeRows.every(function (entry) {
        return Number(entry.rank) > 0;
      });

      var displayRows = hasPrecomputedRank
        ? safeRows
        : safeRows.slice().sort(function (a, b) {
            return Number(b.rating || 0) - Number(a.rating || 0);
          });

      rowsRoot.innerHTML = displayRows.map(function (entry, index) {
        var rank = hasPrecomputedRank ? Number(entry.rank) : index + 1;
        return [
          "<article class=\"", getRowClassByRank(rank), "\">",
          "<span class=\"lb-rank-cell\">",
          renderRankGlyph(rank),
          "</span>",
          "<span class=\"lb-player\">", escapeHtml(entry.player || "Unknown"), "</span>",
          "<span class=\"lb-points\">", escapeHtml(entry.rating || 0), "</span>",
          "</article>"
        ].join("");
      }).join("");
    }

    function getTabConfig(tabKey) {
      return config.tabs.find(function (tab) {
        return tab.key === tabKey;
      }) || null;
    }

    function fetchEntriesForTab(tabKey) {
      var cacheKey = String(tabKey);
      if (tabCache[cacheKey]) {
        return Promise.resolve(tabCache[cacheKey]);
      }

      var tab = getTabConfig(tabKey);
      if (!tab) {
        return Promise.resolve([]);
      }

      var gameCode = String(config.gameCode || "").toLowerCase();
      if (!gameCode) {
        var fallbackRows = Array.isArray(tab.entries) ? tab.entries : [];
        tabCache[cacheKey] = fallbackRows;
        return Promise.resolve(fallbackRows);
      }

      var url = buildApiUrl(gameCode, tab.key, { limit: 250, offset: 0 });
      return fetchJsonWithTimeout(url, API_TIMEOUT_MS)
        .then(function (json) {
          var rows = normalizeApiRows(json && json.rows);
          tabCache[cacheKey] = rows;
          return rows;
        })
        .catch(function () {
          var fallbackRows = Array.isArray(tab.entries) ? tab.entries : [];
          tabCache[cacheKey] = fallbackRows;
          return fallbackRows;
        });
    }

    function renderRowsForTab(tabKey) {
      var localVersion = renderVersion + 1;
      renderVersion = localVersion;
      rowsRoot.innerHTML = "<p class=\"leaderboard-empty\">Loading leaderboard...</p>";

      fetchEntriesForTab(tabKey).then(function (rows) {
        if (localVersion !== renderVersion) {
          return;
        }
        renderRows(rows);
      });
    }

    function setActiveTab(tabKey) {
      var activeTab = getTabConfig(tabKey) || config.tabs[0];
      var activeButton = null;

      tabButtons.forEach(function (button) {
        var isActive = button.getAttribute("data-lb-tab") === activeTab.key;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-selected", isActive ? "true" : "false");
        button.tabIndex = isActive ? 0 : -1;
        if (isActive) {
          activeButton = button;
        }
      });

      if (activeButton) {
        panel.setAttribute("aria-labelledby", activeButton.id);
      }

      syncActiveTabGeometry();
      renderRowsForTab(activeTab.key);
    }

    function bindTabEvents() {
      var currentFile = getCurrentPageFilename();

      tabButtons.forEach(function (button, index) {
        button.addEventListener("click", function (event) {
          var tabKey = button.getAttribute("data-lb-tab");
          var tabHref = String(button.getAttribute("data-lb-href") || "").toLowerCase();

          if (tabHref && tabHref !== currentFile) {
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
      bindTabEvents: bindTabEvents,
      setActiveTab: setActiveTab,
      syncActiveTabGeometry: syncActiveTabGeometry
    };
  }

  function initLeaderboardsPage() {
    var config = getPageConfig();
    if (!config || !Array.isArray(config.tabs) || config.tabs.length === 0) {
      return;
    }

    var mount = document.getElementById("leaderboards-root");
    if (!mount) {
      return;
    }

    var pageKey = getPageKey();
    mount.innerHTML = buildShellHtml(config, pageKey);

    var controller = createController(config);
    if (!controller) {
      return;
    }

    controller.bindTabEvents();
    controller.setActiveTab(config.defaultTabKey || config.tabs[0].key);

    window.addEventListener("resize", controller.syncActiveTabGeometry);
    var tabsRoot = document.querySelector(".msbl-board-tabs");
    if (tabsRoot) {
      tabsRoot.addEventListener("scroll", controller.syncActiveTabGeometry, { passive: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initLeaderboardsPage);
    return;
  }

  initLeaderboardsPage();
})();
