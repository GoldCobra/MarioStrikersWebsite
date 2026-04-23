(function () {
  "use strict";

  var PAGE_KEY = "msbl";
  var TEMPLATE_URL = "./templates/msbl-gear-builder.html";

  var SCRIPT_ORDER = [
    { src: "../assets/gear-builder/scripts/jquery.min.js" },
    { src: "../assets/gear-builder/scripts/data.js", type: "module" },
    { src: "../assets/gear-builder/scripts/gear.js", type: "module" },
    { src: "../assets/gear-builder/scripts/builder.js", type: "module" },
    { src: "../assets/gear-builder/scripts/screenshot.js", type: "module" },
    { src: "../assets/gear-builder/scripts/html2canvas.min.js" },
    { src: "../assets/gear-builder/scripts/filesaver.min.js" },
    { src: "../assets/gear-builder/scripts/tabs.js" },
    { src: "../assets/gear-builder/scripts/add.js" },
    { src: "../assets/gear-builder/scripts/hiderows.js" },
    { src: "../assets/gear-builder/scripts/select.js" },
    { src: "../assets/gear-builder/scripts/checklist.js" },
    { src: "../assets/gear-builder/scripts/sliders.js" },
    { src: "../assets/gear-builder/scripts/menu.js" }
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

  function syncAllStatOverlays(host) {
    var cards = host.querySelectorAll('.tab-pane[id^="tab-"]:not(#tab-b) .buildcard');
    for (var i = 0; i < cards.length; i += 1) {
      syncCardStatOverlays(cards[i]);
    }
  }

  function attachStatOverlayObserver(host) {
    var observer = new MutationObserver(function (mutations) {
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

    var valueNodes = host.querySelectorAll('.tab-pane[id^="tab-"]:not(#tab-b) .cardstat .stat');
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
    host.innerHTML = '<p class="msbl-gear-builder-note' + (isError ? ' is-error' : '') + '">' + String(message || "") + "</p>";
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

    renderStatus(host, "Loading Gear Builder...", false);

    try {
      var response = await fetch(TEMPLATE_URL, {
        headers: { Accept: "text/html" }
      });
      if (!response.ok) {
        throw new Error("Template request failed.");
      }

      var templateHtml = await response.text();
      host.innerHTML = templateHtml;

      await loadScriptsSequentially();
      syncAllStatOverlays(host);
      attachStatOverlayObserver(host);
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
