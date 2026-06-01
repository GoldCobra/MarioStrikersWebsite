(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";
  var LINE_THICKNESS = 3;
  var OVERLAY_CLASS = "global-tabs-line-overlay";
  var gradientCounter = 0;
  var EPSILON = 0.001;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function snapRange(rawLeft, rawWidth, maxWidth) {
    var left = clamp(Math.floor(rawLeft + EPSILON), 0, maxWidth);
    var right = clamp(Math.ceil(rawLeft + rawWidth - EPSILON), left, maxWidth);
    return {
      left: left,
      right: right,
      width: right - left
    };
  }

  function ensureOverlay(tabsRoot) {
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

  function getGradientId(overlay) {
    var existing = overlay.getAttribute("data-gradient-id");
    if (existing) {
      return existing;
    }

    gradientCounter += 1;
    var gradientId = "global-tabs-line-gradient-" + gradientCounter;
    overlay.setAttribute("data-gradient-id", gradientId);
    return gradientId;
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
    var gradientId = getGradientId(overlay);

    overlay.setAttribute("viewBox", "0 0 " + overlayWidth + " " + overlayHeight);
    overlay.setAttribute("width", String(overlayWidth));
    overlay.setAttribute("height", String(overlayHeight));
    overlay.style.width = overlayWidth + "px";
    overlay.style.height = overlayHeight + "px";
    overlay.setAttribute("shape-rendering", "crispEdges");

    var parts = [
      "<defs>",
      "<linearGradient id=\"" + gradientId + "\" x1=\"0\" y1=\"0\" x2=\"" + overlayWidth + "\" y2=\"0\" gradientUnits=\"userSpaceOnUse\">",
      "<stop offset=\"0%\" stop-color=\"#b33a08\"/>",
      "<stop offset=\"50%\" stop-color=\"#c77603\"/>",
      "<stop offset=\"100%\" stop-color=\"#b33a08\"/>",
      "</linearGradient>",
      "</defs>"
    ];

    if (leftBottomWidth > 0) {
      parts.push(
        "<rect x=\"0\" y=\"" + bottomY + "\" width=\"" + leftBottomWidth + "\" height=\"" + LINE_THICKNESS + "\" fill=\"url(#" + gradientId + ")\"/>"
      );
    }

    if (rightBottomWidth > 0) {
      parts.push(
        "<rect x=\"" + activeRight + "\" y=\"" + bottomY + "\" width=\"" + rightBottomWidth + "\" height=\"" + LINE_THICKNESS + "\" fill=\"url(#" + gradientId + ")\"/>"
      );
    }

    if (activeW > 0) {
      var isSingleTab = tabCount <= 1;
      var hasLeftEdge = !isSingleTab && activeIndex === 0;
      var hasRightEdge = !isSingleTab && activeIndex === tabCount - 1;

      parts.push(
        "<rect x=\"" + activeX + "\" y=\"" + topY + "\" width=\"" + activeW + "\" height=\"" + LINE_THICKNESS + "\" fill=\"url(#" + gradientId + ")\"/>"
      );

      if (hasLeftEdge) {
        parts.push(
          "<rect x=\"" + activeX + "\" y=\"" + topY + "\" width=\"" + LINE_THICKNESS + "\" height=\"" + overlayHeight + "\" fill=\"url(#" + gradientId + ")\"/>"
        );
      }

      if (hasRightEdge) {
        parts.push(
          "<rect x=\"" + (activeRight - LINE_THICKNESS) + "\" y=\"" + topY + "\" width=\"" + LINE_THICKNESS + "\" height=\"" + overlayHeight + "\" fill=\"url(#" + gradientId + ")\"/>"
        );
      }
    }

    overlay.innerHTML = parts.join("");
  }

  function buildBaseLineOnly(overlay, tabsWidth, tabsHeight) {
    var overlayWidth = Math.max(1, tabsWidth);
    var overlayHeight = Math.max(1, tabsHeight);
    var bottomY = Math.max(0, overlayHeight - LINE_THICKNESS);
    var gradientId = getGradientId(overlay);

    overlay.setAttribute("viewBox", "0 0 " + overlayWidth + " " + overlayHeight);
    overlay.setAttribute("width", String(overlayWidth));
    overlay.setAttribute("height", String(overlayHeight));
    overlay.style.width = overlayWidth + "px";
    overlay.style.height = overlayHeight + "px";
    overlay.setAttribute("shape-rendering", "crispEdges");

    overlay.innerHTML = [
      "<defs>",
      "<linearGradient id=\"" + gradientId + "\" x1=\"0\" y1=\"0\" x2=\"" + overlayWidth + "\" y2=\"0\" gradientUnits=\"userSpaceOnUse\">",
      "<stop offset=\"0%\" stop-color=\"#b33a08\"/>",
      "<stop offset=\"50%\" stop-color=\"#c77603\"/>",
      "<stop offset=\"100%\" stop-color=\"#b33a08\"/>",
      "</linearGradient>",
      "</defs>",
      "<rect x=\"0\" y=\"" + bottomY + "\" width=\"" + overlayWidth + "\" height=\"" + LINE_THICKNESS + "\" fill=\"url(#" + gradientId + ")\"/>"
    ].join("");
  }

  function initTabsGroup(options) {
    var tabsRoot = options && options.tabsRoot;
    var shell = options && options.shell;
    var tabSelector = (options && options.tabSelector) || ".global-tab";
    var activeSelector = (options && options.activeSelector) || ".global-tab.is-active";

    if (!tabsRoot) {
      return null;
    }

    function updateOverflowState() {
      var hasOverflow = tabsRoot.scrollWidth > tabsRoot.clientWidth + 2;
      tabsRoot.classList.toggle("is-overflowing", hasOverflow);
      return hasOverflow;
    }

    function shouldRevealActiveTab() {
      var hasOverflow = updateOverflowState();
      if (!hasOverflow) {
        return false;
      }

      if (window.matchMedia) {
        return window.matchMedia("(max-width: 760px)").matches;
      }

      return window.innerWidth <= 760;
    }

    function shouldCenterActiveTab() {
      if (shell && shell.classList && shell.classList.contains("leaderboard-tabs-shell")) {
        return false;
      }

      if (window.matchMedia) {
        return window.matchMedia("(max-width: 430px)").matches;
      }

      return window.innerWidth <= 430;
    }

    function revealActiveTab() {
      var activeTab = tabsRoot.querySelector(activeSelector);
      if (!activeTab || !shouldRevealActiveTab()) {
        return;
      }

      window.requestAnimationFrame(function () {
        var rootRect = tabsRoot.getBoundingClientRect();
        var activeRect = activeTab.getBoundingClientRect();
        var needsScroll = shouldCenterActiveTab() ||
          activeRect.left < rootRect.left + 8 ||
          activeRect.right > rootRect.right - 8;
        if (!needsScroll) {
          return;
        }

        var targetLeft = tabsRoot.scrollLeft +
          (activeRect.left - rootRect.left) -
          ((tabsRoot.clientWidth - activeRect.width) / 2);

        tabsRoot.scrollTo({
          left: Math.max(0, targetLeft),
          behavior: "auto"
        });
      });
    }

    function sync() {
      var activeTab = tabsRoot.querySelector(activeSelector);
      var overlay = ensureOverlay(tabsRoot);
      var hasOverflow = updateOverflowState();
      var tabsWidth = Math.max(1, Math.round(hasOverflow ? tabsRoot.scrollWidth : tabsRoot.clientWidth));
      var tabsHeight = Math.max(1, Math.round(tabsRoot.clientHeight));

      if (!activeTab) {
        buildBaseLineOnly(overlay, tabsWidth, tabsHeight);
        return null;
      }

      var tabsRect = tabsRoot.getBoundingClientRect();
      var activeRect = activeTab.getBoundingClientRect();
      var shellRect = shell ? shell.getBoundingClientRect() : tabsRect;
      var shellWidth = Math.max(1, Math.round(shell ? shell.clientWidth : tabsWidth));
      var shellHeight = Math.max(1, Math.round(shell ? shell.clientHeight : tabsHeight));

      var activeLeftRaw = (activeRect.left - tabsRect.left) + (hasOverflow ? tabsRoot.scrollLeft : 0);
      var activeSnap = snapRange(activeLeftRaw, activeRect.width, tabsWidth);
      var lineActiveLeft = activeSnap.left;
      var lineActiveWidth = activeSnap.width;

      var shellActiveLeftRaw = activeRect.left - shellRect.left;
      var shellActiveSnap = snapRange(shellActiveLeftRaw, activeRect.width, shellWidth);
      var shellActiveLeft = shellActiveSnap.left;
      var shellActiveWidth = shellActiveSnap.width;

      var tabsHeadTopRaw = tabsRect.top - shellRect.top;
      var tabsHeadTop = Math.round(clamp(tabsHeadTopRaw, 0, shellHeight));
      var tabsHeadHeight = Math.round(clamp(tabsRect.height, 0, shellHeight - tabsHeadTop));
      var tabsPanelTop = Math.round(clamp(tabsHeadTop + tabsHeadHeight, 0, shellHeight));
      var tabsPanelHeight = Math.round(clamp(shellHeight - tabsPanelTop, 0, shellHeight));

      var tabItems = Array.prototype.slice.call(tabsRoot.querySelectorAll(tabSelector));
      var activeIndex = tabItems.indexOf(activeTab);
      var tabCount = tabItems.length;

      if (shell) {
        shell.style.setProperty("--active-left", shellActiveLeft + "px");
        shell.style.setProperty("--active-width", shellActiveWidth + "px");
        shell.style.setProperty("--tabs-head-top", tabsHeadTop + "px");
        shell.style.setProperty("--tabs-head-height", tabsHeadHeight + "px");
        shell.style.setProperty("--tabs-panel-top", tabsPanelTop + "px");
        var suppressPanel = typeof getComputedStyle === "function" &&
          getComputedStyle(shell).getPropertyValue("--tabs-suppress-panel").trim() === "1";
        shell.style.setProperty("--tabs-panel-height", suppressPanel ? "0" : tabsPanelHeight + "px");
        shell.style.setProperty("--tabs-render-height", tabsHeight + "px");
      }

      buildLineRects(overlay, tabsWidth, tabsHeight, lineActiveLeft, lineActiveWidth, activeIndex, tabCount);
      return {
        activeLeft: lineActiveLeft,
        activeWidth: lineActiveWidth,
        tabsWidth: tabsWidth,
        tabsHeight: tabsHeight
      };
    }

    sync();
    revealActiveTab();
    tabsRoot.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", function () {
      sync();
      revealActiveTab();
    });
    window.addEventListener("load", function () {
      sync();
      revealActiveTab();
    });

    var images = tabsRoot.querySelectorAll("img");
    Array.prototype.forEach.call(images, function (image) {
      if (image.complete) {
        return;
      }
      image.addEventListener("load", function () {
        sync();
        revealActiveTab();
      }, { once: true });
    });

    if (typeof ResizeObserver === "function") {
      var resizeObserver = new ResizeObserver(function () {
        sync();
        revealActiveTab();
      });
      resizeObserver.observe(tabsRoot);
      if (shell) {
        resizeObserver.observe(shell);
      }
    }

    if (document.fonts && typeof document.fonts.ready === "object") {
      document.fonts.ready.then(function () {
        sync();
        revealActiveTab();
      });
    }

    return {
      sync: sync,
      revealActiveTab: revealActiveTab
    };
  }

  window.GlobalTabsEngine = {
    initTabsGroup: initTabsGroup
  };
})();
