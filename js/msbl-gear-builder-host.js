(function () {
  "use strict";

  var PAGE_KEY = "msbl-gear-builder";
  var TEMPLATE_VERSION = "20260508-lazy-v1";
  var TEMPLATE_URL = "/pages/templates/msbl-gear-builder.html?v=" + TEMPLATE_VERSION;
  var CHARACTER_IMAGE_EXTENSION_PATTERN = /(\.\.\/assets\/gear-builder\/images\/characters\/[^"'?#]+)\.png\b/gi;
  var CHARACTER_ICON_EXTENSION_PATTERN = /(\.\.\/assets\/gear-builder\/images\/characters-icons\/[^"'?#]+)\.png\b/gi;
  var PANE_LOAD_STATE_MESSAGES = {
    loading: "Loading character...",
    error: "Failed to load character."
  };

  var CHARACTER_PANES = {
    "tab-01": { characterId: 1, url: "/pages/templates/msbl-gear-builder/panes/mario.html?v=" + TEMPLATE_VERSION },
    "tab-02": { characterId: 2, url: "/pages/templates/msbl-gear-builder/panes/luigi.html?v=" + TEMPLATE_VERSION },
    "tab-03": { characterId: 3, url: "/pages/templates/msbl-gear-builder/panes/bowser.html?v=" + TEMPLATE_VERSION },
    "tab-04": { characterId: 4, url: "/pages/templates/msbl-gear-builder/panes/peach.html?v=" + TEMPLATE_VERSION },
    "tab-05": { characterId: 5, url: "/pages/templates/msbl-gear-builder/panes/rosalina.html?v=" + TEMPLATE_VERSION },
    "tab-06": { characterId: 6, url: "/pages/templates/msbl-gear-builder/panes/toad.html?v=" + TEMPLATE_VERSION },
    "tab-07": { characterId: 7, url: "/pages/templates/msbl-gear-builder/panes/yoshi.html?v=" + TEMPLATE_VERSION },
    "tab-08": { characterId: 8, url: "/pages/templates/msbl-gear-builder/panes/dk.html?v=" + TEMPLATE_VERSION },
    "tab-09": { characterId: 9, url: "/pages/templates/msbl-gear-builder/panes/wario.html?v=" + TEMPLATE_VERSION },
    "tab-10": { characterId: 10, url: "/pages/templates/msbl-gear-builder/panes/waluigi.html?v=" + TEMPLATE_VERSION },
    "tab-11": { characterId: 11, url: "/pages/templates/msbl-gear-builder/panes/shy-guy.html?v=" + TEMPLATE_VERSION },
    "tab-12": { characterId: 12, url: "/pages/templates/msbl-gear-builder/panes/daisy.html?v=" + TEMPLATE_VERSION },
    "tab-13": { characterId: 13, url: "/pages/templates/msbl-gear-builder/panes/pauline.html?v=" + TEMPLATE_VERSION },
    "tab-14": { characterId: 14, url: "/pages/templates/msbl-gear-builder/panes/diddy-kong.html?v=" + TEMPLATE_VERSION },
    "tab-15": { characterId: 15, url: "/pages/templates/msbl-gear-builder/panes/bowser-jr.html?v=" + TEMPLATE_VERSION },
    "tab-16": { characterId: 16, url: "/pages/templates/msbl-gear-builder/panes/birdo.html?v=" + TEMPLATE_VERSION }
  };

  var SCRIPT_ORDER = [
    { src: "../assets/gear-builder/scripts/jquery.min.js" },
    { src: "../assets/gear-builder/scripts/data.js", type: "module" },
    { src: "../assets/gear-builder/scripts/gear.js?v=20260508-lazy-v1", type: "module" },
    { src: "../assets/gear-builder/scripts/builder.js?v=20260507-perf-v1", type: "module" },
    { src: "../assets/gear-builder/scripts/screenshot.js?v=20260508-lazy-v1", type: "module" },
    { src: "../assets/gear-builder/scripts/html2canvas.min.js" },
    { src: "../assets/gear-builder/scripts/filesaver.min.js" },
    { src: "../assets/gear-builder/scripts/tabs.js" },
    { src: "../assets/gear-builder/scripts/add.js" },
    { src: "../assets/gear-builder/scripts/hiderows.js" },
    { src: "../assets/gear-builder/scripts/select.js" },
    { src: "../assets/gear-builder/scripts/checklist.js" },
    { src: "../assets/gear-builder/scripts/sliders.js" },
    { src: "../assets/gear-builder/scripts/menu.js" },
    { src: "../assets/gear-builder/scripts/presets.js?v=20260508-lazy-v1", type: "module" }
  ];

  var STAT_ROWS = [
    { rowClass: "strengthbar", valueClass: "str", label: "STRENGTH" },
    { rowClass: "speedbar", valueClass: "spe", label: "SPEED" },
    { rowClass: "shotbar", valueClass: "sho", label: "SHOOTING" },
    { rowClass: "passbar", valueClass: "pas", label: "PASSING" },
    { rowClass: "techbar", valueClass: "tec", label: "TECHNIQUE" }
  ];

  function ensureOverlayNode(rowNode) {
    var overlay = rowNode.querySelector(".stat-text-overlay");
    if (overlay) {
      return overlay;
    }

    overlay = document.createElement("div");
    overlay.className = "stat-text-overlay";

    var label = document.createElement("span");
    label.className = "stat-text-label";
    overlay.appendChild(label);

    var value = document.createElement("span");
    value.className = "stat-text-value";
    overlay.appendChild(value);

    rowNode.appendChild(overlay);
    return overlay;
  }

  function syncCardStatOverlays(cardNode) {
    if (!cardNode) {
      return;
    }

    for (var i = 0; i < STAT_ROWS.length; i += 1) {
      var rowMap = STAT_ROWS[i];
      var barRow = cardNode.querySelector("." + rowMap.rowClass);
      if (!barRow) {
        continue;
      }

      var sourceValue = cardNode.querySelector(".cardstat .stat." + rowMap.valueClass);
      var valueText = sourceValue ? String(sourceValue.textContent || "").trim() : "";

      var overlay = ensureOverlayNode(barRow);
      var overlayLabel = overlay.querySelector(".stat-text-label");
      var overlayValue = overlay.querySelector(".stat-text-value");

      if (overlayLabel) {
        overlayLabel.textContent = rowMap.label;
      }
      if (overlayValue) {
        overlayValue.textContent = valueText;
      }
    }
  }

  function syncPaneStatOverlays(paneNode) {
    if (!paneNode) {
      return;
    }

    var cards = paneNode.querySelectorAll(".buildcard");
    for (var i = 0; i < cards.length; i += 1) {
      syncCardStatOverlays(cards[i]);
    }
  }

  function createStatOverlayObserver() {
    return new MutationObserver(function (mutations) {
      var updatedCards = new Set();

      for (var i = 0; i < mutations.length; i += 1) {
        var mutation = mutations[i];
        var target = mutation.target && mutation.target.nodeType === 3
          ? mutation.target.parentElement
          : mutation.target;

        if (!target || typeof target.closest !== "function") {
          continue;
        }

        var card = target.closest(".buildcard");
        if (card) {
          updatedCards.add(card);
        }
      }

      updatedCards.forEach(function (cardNode) {
        syncCardStatOverlays(cardNode);
      });
    });
  }

  function observePaneStatValues(observer, paneNode) {
    if (!observer || !paneNode) {
      return;
    }

    var valueNodes = paneNode.querySelectorAll(".cardstat .stat");
    for (var i = 0; i < valueNodes.length; i += 1) {
      observer.observe(valueNodes[i], {
        childList: true,
        characterData: true,
        subtree: true
      });
    }
  }

  function loadScript(entry) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = entry.src;
      if (entry.type) {
        script.type = entry.type;
      }
      script.async = false;
      script.onload = function () {
        resolve();
      };
      script.onerror = function () {
        reject(new Error("Failed to load script: " + entry.src));
      };
      document.body.appendChild(script);
    });
  }

  async function loadScriptsSequentially() {
    for (var i = 0; i < SCRIPT_ORDER.length; i += 1) {
      await loadScript(SCRIPT_ORDER[i]);
    }
  }

  function renderStatus(host, message, isError) {
    host.innerHTML = '<p class="msbl-gear-builder-note' + (isError ? " is-error" : "") + '">' + String(message || "") + "</p>";
  }

  function rewriteOptimizedAssetMarkup(markup) {
    return String(markup || "")
      .replace(CHARACTER_IMAGE_EXTENSION_PATTERN, "$1.webp")
      .replace(CHARACTER_ICON_EXTENSION_PATTERN, "$1.webp");
  }

  function attachWebpFallbacks(root, selector) {
    var images = root.querySelectorAll(selector);
    for (var i = 0; i < images.length; i += 1) {
      images[i].addEventListener("error", function handleError() {
        if (!this || this.getAttribute("data-webp-fallback-applied") === "true") {
          return;
        }

        this.setAttribute("data-webp-fallback-applied", "true");
        this.src = String(this.src || "").replace(/\.webp(\?.*)?$/i, ".png$1");
      }, { once: true });
    }
  }

  function attachGearBuilderImageFallbacks(root) {
    attachWebpFallbacks(root, 'img[src*="../assets/gear-builder/images/characters/"][src$=".webp"]');
    attachWebpFallbacks(root, 'img[src*="../assets/gear-builder/images/characters-icons/"][src$=".webp"]');
  }

  function getActivePane(host) {
    return host.querySelector(".tab-content .tab-pane:not(.hidden)") || host.querySelector(".tab-content .tab-pane");
  }

  function syncHostHeight(host) {
    if (!host) {
      return;
    }

    var activePane = getActivePane(host);
    if (!activePane) {
      return;
    }

    var bar = host.querySelector(".bar-area");
    var barHeight = bar ? bar.offsetHeight : 56;
    var contentHeight = Math.max(activePane.scrollHeight || 0, activePane.offsetHeight || 0);
    var nextHeight = Math.max(420, Math.ceil(barHeight + contentHeight + 12));
    host.style.minHeight = String(nextHeight) + "px";
  }

  function setupHostHeightSync(host) {
    var rafToken = 0;

    function scheduleSync() {
      if (rafToken) {
        return;
      }

      rafToken = window.requestAnimationFrame(function () {
        rafToken = 0;
        syncHostHeight(host);
      });
    }

    scheduleSync();

    host.addEventListener("click", function () {
      window.setTimeout(scheduleSync, 0);
    }, true);

    host.addEventListener("input", function () {
      window.setTimeout(scheduleSync, 0);
    }, true);

    window.addEventListener("resize", scheduleSync);

    var tabContent = host.querySelector(".tab-content");
    if (tabContent) {
      var observer = new MutationObserver(function () {
        scheduleSync();
      });
      observer.observe(tabContent, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "aria-selected"]
      });
    }

    return scheduleSync;
  }

  function getCharacterPaneNode(host, paneId) {
    return host.querySelector('.tab-pane[id="' + paneId + '"]');
  }

  function renderPaneStatus(paneNode, message, isError) {
    if (!paneNode) {
      return;
    }

    paneNode.innerHTML = '<p class="msbl-gear-pane-state' + (isError ? " is-error" : "") + '" role="status">' + String(message || "") + "</p>";
  }

  function extractPaneInnerHtml(partialHtml, expectedPaneId) {
    var template = document.createElement("template");
    template.innerHTML = rewriteOptimizedAssetMarkup(partialHtml).trim();
    var paneNode = template.content.querySelector(".tab-pane");

    if (!paneNode || paneNode.id !== expectedPaneId) {
      throw new Error("Gear Builder pane markup did not match " + expectedPaneId + ".");
    }

    return paneNode.innerHTML;
  }

  function restoreCharacterDraft(characterId) {
    var presetsApi = window.MSBL_GEAR_PRESETS;
    if (!presetsApi || typeof presetsApi.restoreDraftForCharacter !== "function") {
      return false;
    }

    return presetsApi.restoreDraftForCharacter(characterId);
  }

  function setupLazyPaneLoading(host, statObserver, scheduleSync) {
    var paneLoadPromises = Object.create(null);

    function ensureCharacterPaneLoaded(paneId) {
      var paneConfig = CHARACTER_PANES[paneId];
      var paneNode = getCharacterPaneNode(host, paneId);

      if (!paneConfig || !paneNode) {
        return Promise.resolve(null);
      }

      if (paneNode.getAttribute("data-pane-load-state") === "loaded") {
        return Promise.resolve(paneNode);
      }

      if (paneLoadPromises[paneId]) {
        return paneLoadPromises[paneId];
      }

      paneNode.setAttribute("data-pane-load-state", "loading");
      renderPaneStatus(paneNode, PANE_LOAD_STATE_MESSAGES.loading, false);
      scheduleSync();

      paneLoadPromises[paneId] = fetch(paneConfig.url, {
        headers: { Accept: "text/html" }
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error("Pane request failed.");
          }
          return response.text();
        })
        .then(function (partialHtml) {
          paneNode.innerHTML = extractPaneInnerHtml(partialHtml, paneId);
          paneNode.setAttribute("data-pane-load-state", "loaded");
          attachGearBuilderImageFallbacks(paneNode);
          syncPaneStatOverlays(paneNode);
          observePaneStatValues(statObserver, paneNode);
          restoreCharacterDraft(paneConfig.characterId);
          syncPaneStatOverlays(paneNode);
          scheduleSync();
          delete paneLoadPromises[paneId];
          return paneNode;
        })
        .catch(function (error) {
          paneNode.setAttribute("data-pane-load-state", "error");
          renderPaneStatus(paneNode, PANE_LOAD_STATE_MESSAGES.error, true);
          scheduleSync();
          delete paneLoadPromises[paneId];
          throw error;
        });

      return paneLoadPromises[paneId];
    }

    host.addEventListener("click", function (event) {
      var tabLink = event.target && event.target.closest
        ? event.target.closest('.tab-link-icon[aria-controls^="tab-"]')
        : null;

      if (!tabLink) {
        return;
      }

      var paneId = String(tabLink.getAttribute("aria-controls") || "");
      if (!paneId || !CHARACTER_PANES[paneId]) {
        return;
      }

      ensureCharacterPaneLoaded(paneId).catch(function () {
        // Error state is rendered inline in the placeholder pane.
      });
    }, true);
  }

  async function initGearBuilderPage() {
    var page = String(document.body && document.body.getAttribute("data-page") || "").toLowerCase();
    if (page !== PAGE_KEY) {
      return;
    }

    var host = document.getElementById("msbl-gear-builder-host");
    if (!host) {
      return;
    }

    renderStatus(host, "Loading...", false);

    try {
      var response = await fetch(TEMPLATE_URL, {
        headers: { Accept: "text/html" }
      });
      if (!response.ok) {
        throw new Error("Template request failed.");
      }

      host.innerHTML = rewriteOptimizedAssetMarkup(await response.text());
      attachGearBuilderImageFallbacks(host);
      await loadScriptsSequentially();

      var statObserver = createStatOverlayObserver();
      var scheduleSync = setupHostHeightSync(host);
      setupLazyPaneLoading(host, statObserver, scheduleSync);
      scheduleSync();
    } catch (_error) {
      renderStatus(host, "Failed to load Gear Builder.", true);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initGearBuilderPage);
    return;
  }

  initGearBuilderPage();
})();
