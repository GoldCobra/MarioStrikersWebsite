(function () {
  "use strict";

  // The site generator renders the navigation, content tabs, footer, favicons and breadcrumbs into
  // every page (apps/web/src/layouts). This script adds their behaviour: the account widget, the
  // tab strip, centring of overflowing navigation, link prefetching and legacy URL redirects.

  var prefetchedHrefMap = Object.create(null);
  var LEGACY_SUBMENU_ROUTE_MAP = {
    games: {
      msbl: "msbl",
      msc: "msc",
      sms: "sms"
    },
    competitive: {
      rules: "competitive-rules",
      leaderboards: "competitive-leaderboards",
      "tier-lists": "competitive-tier-lists",
      msl: "msl",
      tournaments: "competitive-tournaments"
    }
  };

  function toPageSlug(raw) {
    return String(raw || "")
      .toLowerCase()
      .replace(/^\/*(?:pages\/)?/, "")
      .replace(/\/+$/, "")
      .replace(/\.html$/, "");
  }

  function getPageSlug() {
    var body = document.body;
    var byDataset = body && body.getAttribute("data-page");
    if (byDataset) {
      return toPageSlug(byDataset) || "index";
    }

    var path = String(window.location.pathname || "").toLowerCase();
    if (!path || path === "/") {
      return "index";
    }

    var trimmedPath = path.replace(/\/+$/, "");
    return toPageSlug(trimmedPath.split("/").pop()) || "index";
  }

  function toHref(slug) {
    var pageSlug = toPageSlug(slug);
    return !pageSlug || pageSlug === "index" ? "/" : "/" + pageSlug;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getDiscordAvatarUrl(user) {
    var userId = String(user && user.id || "").trim();
    var avatar = String(user && user.avatar || "").trim();
    if (!userId || !avatar) {
      return "";
    }
    return "https://cdn.discordapp.com/avatars/" + encodeURIComponent(userId) + "/" + encodeURIComponent(avatar) + ".png?size=64";
  }

  function getRequestIdleCallback() {
    return window.requestIdleCallback || function (callback) {
      return window.setTimeout(callback, 900);
    };
  }

  function getPrefetchUrl(href) {
    var url;
    try {
      url = new URL(href, window.location.href);
    } catch (error) {
      return null;
    }

    if (url.origin !== window.location.origin) {
      return null;
    }

    if (url.pathname === window.location.pathname && url.search === window.location.search) {
      return null;
    }

    return url;
  }

  function buildNormalizedSearch(params) {
    var nextParams = new URLSearchParams();
    params.forEach(function (value, key) {
      if (key === "submenu" || key === "tabs") {
        return;
      }
      nextParams.append(key, value);
    });

    var query = nextParams.toString();
    return query ? "?" + query : "";
  }

  // Old links opened overviews with ?submenu=<section> or hid tabs with ?tabs=none.
  function normalizeLegacyTabUrl(pageSlug) {
    var params = new URLSearchParams(window.location.search || "");
    if (!params.toString()) {
      return false;
    }

    var submenu = String(params.get("submenu") || "").trim().toLowerCase();
    var tabs = String(params.get("tabs") || "").trim().toLowerCase();
    var targetSlug = "";
    var routeMap = LEGACY_SUBMENU_ROUTE_MAP[pageSlug];

    if (submenu && routeMap && routeMap[submenu]) {
      targetSlug = routeMap[submenu];
    } else if (submenu || tabs === "none") {
      targetSlug = pageSlug;
    }

    if (!targetSlug) {
      return false;
    }

    var nextUrl = toHref(targetSlug) + buildNormalizedSearch(params) + String(window.location.hash || "");
    var currentUrl = String(window.location.pathname || "") + String(window.location.search || "") + String(window.location.hash || "");

    if (nextUrl === currentUrl) {
      return false;
    }

    window.location.replace(nextUrl);
    return true;
  }

  function prefetchHref(href) {
    var url = getPrefetchUrl(href);
    if (!url || prefetchedHrefMap[url.href]) {
      return;
    }

    prefetchedHrefMap[url.href] = true;
    var link = document.createElement("link");
    link.rel = "prefetch";
    link.as = "document";
    link.href = url.href;
    document.head.appendChild(link);
  }

  function prefetchAnchor(anchor) {
    if (!anchor || !anchor.getAttribute) {
      return;
    }
    prefetchHref(anchor.getAttribute("href"));
  }

  function bindLinkPrefetch(root) {
    if (!root || root.getAttribute("data-prefetch-bound") === "true") {
      return;
    }

    root.setAttribute("data-prefetch-bound", "true");
    root.addEventListener("pointerenter", function (event) {
      prefetchAnchor(event.target && event.target.closest ? event.target.closest("a[href]") : null);
    }, true);
    root.addEventListener("focusin", function (event) {
      prefetchAnchor(event.target && event.target.closest ? event.target.closest("a[href]") : null);
    });
  }

  function scheduleInitialLinkPrefetch() {
    var runWhenIdle = getRequestIdleCallback();
    runWhenIdle(function () {
      var anchors = Array.prototype.slice.call(document.querySelectorAll(
        "#global-subnav a[href], #global-content-tabs a[href]"
      ));
      anchors.slice(0, 8).forEach(prefetchAnchor);
    });
  }

  function renderAccountLoggedOut(root) {
    if (!root) {
      return;
    }
    root.setAttribute("data-auth-state", "logged-out");
    root.innerHTML = "";
  }

  function renderAccountLoggedIn(root, user) {
    if (!root) {
      return;
    }
    var displayName = String(user && (user.global_name || user.username || user.id) || "Account").trim();
    var avatarUrl = getDiscordAvatarUrl(user);
    var avatarHtml = avatarUrl
      ? '<img class="global-account-avatar" src="' + escapeHtml(avatarUrl) + '" alt="" aria-hidden="true" referrerpolicy="no-referrer" onerror="this.hidden=true;">'
      : '<span class="global-account-icon" aria-hidden="true">D</span>';

    root.setAttribute("data-auth-state", "logged-in");
    root.innerHTML = [
      '<button class="global-account-button global-account-trigger" type="button" aria-haspopup="menu" aria-expanded="false" data-account-action="toggle">',
      avatarHtml,
      '<span class="global-account-name">', escapeHtml(displayName), "</span>",
      "</button>",
      '<div class="global-account-menu" role="menu" hidden>',
      '<a class="global-account-menu-item" role="menuitem" href="/profile">My Profile</a>',
      '<button class="global-account-menu-item" role="menuitem" type="button" disabled>Modify Profile</button>',
      '<button class="global-account-menu-item" role="menuitem" type="button" data-account-action="logout">Logout</button>',
      "</div>"
    ].join("");
  }

  function closeAccountMenu(root) {
    if (!root) {
      return;
    }
    var menu = root.querySelector(".global-account-menu");
    var trigger = root.querySelector(".global-account-trigger");
    if (menu) {
      menu.hidden = true;
    }
    if (trigger) {
      trigger.setAttribute("aria-expanded", "false");
    }
  }

  function toggleAccountMenu(root) {
    var menu = root && root.querySelector(".global-account-menu");
    var trigger = root && root.querySelector(".global-account-trigger");
    if (!menu || !trigger) {
      return;
    }
    var nextOpen = !!menu.hidden;
    menu.hidden = !nextOpen;
    trigger.setAttribute("aria-expanded", nextOpen ? "true" : "false");
  }

  function bindAccountInteractions(root) {
    if (!root || root.getAttribute("data-account-bound") === "true") {
      return;
    }
    root.setAttribute("data-account-bound", "true");

    root.addEventListener("click", function (event) {
      var actionNode = event.target && event.target.closest
        ? event.target.closest("[data-account-action]")
        : null;
      if (!actionNode || !root.contains(actionNode)) {
        return;
      }

      var action = actionNode.getAttribute("data-account-action");
      if (action === "toggle") {
        event.preventDefault();
        toggleAccountMenu(root);
        return;
      }

      if (action === "logout") {
        event.preventDefault();
        fetch("/api/auth/logout", {
          method: "POST",
          credentials: "same-origin",
          headers: { Accept: "application/json" }
        }).finally(function () {
          if (getPageSlug() === "profile") {
            window.location.reload();
            return;
          }
          renderAccountLoggedOut(root);
        });
      }
    });

    document.addEventListener("click", function (event) {
      if (!root.contains(event.target)) {
        closeAccountMenu(root);
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeAccountMenu(root);
      }
    });
  }

  function showFixtureNotice() {
    var notice = document.getElementById("dev-data-notice");
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "dev-data-notice";
      document.body.appendChild(notice);
    }
    notice.setAttribute("role", "status");
    notice.style.cssText = "position:fixed;bottom:12px;left:12px;right:12px;z-index:2147483647;padding:8px 36px 8px 12px;background:#fff2bd;color:#252015;font:14px system-ui;border:1px solid #796421;border-radius:6px;text-align:center";
    notice.textContent = "Local development: synthetic sample data. Discord login is simulated.";
    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Dismiss local development notice");
    close.style.cssText = "position:absolute;right:8px;top:4px;background:transparent;color:inherit;border:0;font:24px system-ui;cursor:pointer";
    close.addEventListener("click", function () { notice.remove(); });
    notice.appendChild(close);
  }

  function initGlobalAccount(root) {
    if (!root) {
      return;
    }
    bindAccountInteractions(root);
    fetch("/api/auth/me", {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    }).then(function (response) {
      if (!response.ok) {
        throw new Error("Auth status failed.");
      }
      if (response.headers.get("X-Data-Source") === "fixtures") {
        showFixtureNotice();
      }
      return response.json();
    }).then(function (payload) {
      if (payload && payload.authenticated) {
        renderAccountLoggedIn(root, payload.user || {});
        return;
      }
      renderAccountLoggedOut(root);
    }).catch(function () {
      renderAccountLoggedOut(root);
    });
  }

  function initContentTabs(contentTabsRoot) {
    if (!contentTabsRoot || !window.GlobalTabsEngine || typeof window.GlobalTabsEngine.initTabsGroup !== "function") {
      return null;
    }

    var shell = contentTabsRoot.querySelector(".global-tabs-shell");
    var list = contentTabsRoot.querySelector(".global-tabs-list");
    if (!shell || !list) {
      return null;
    }

    return window.GlobalTabsEngine.initTabsGroup({
      shell: shell,
      tabsRoot: list,
      tabSelector: ".global-tab",
      activeSelector: ".global-tab.is-active"
    });
  }

  function shouldCenterScrollableNav() {
    if (window.matchMedia) {
      return window.matchMedia("(max-width: 760px)").matches;
    }

    return window.innerWidth <= 760;
  }

  function syncScrollableNav(container, activeSelector) {
    if (!container) {
      return;
    }

    var hasOverflow = container.scrollWidth > container.clientWidth + 2;
    container.classList.toggle("is-overflowing", hasOverflow);

    if (!hasOverflow) {
      container.scrollLeft = 0;
      return;
    }

    if (!shouldCenterScrollableNav()) {
      return;
    }

    var activeItem = container.querySelector(activeSelector);
    if (!activeItem) {
      return;
    }

    window.requestAnimationFrame(function () {
      var containerRect = container.getBoundingClientRect();
      var activeRect = activeItem.getBoundingClientRect();
      var targetLeft = container.scrollLeft +
        (activeRect.left - containerRect.left) -
        ((container.clientWidth - activeRect.width) / 2);

      container.scrollTo({
        left: Math.max(0, targetLeft),
        behavior: "auto"
      });
    });
  }

  function syncResponsiveNavAlignment() {
    syncScrollableNav(
      document.querySelector(".sub-nav"),
      '.sub-link.is-active, .sub-link[aria-current="page"]'
    );
  }

  var _resizeTimer = null;

  function stabilizeScrollbarLayout() {
    var sbw = window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.style.setProperty("--sbw", sbw + "px");
    document.documentElement.style.paddingRight = "";
  }

  function initGlobalShell() {
    if (normalizeLegacyTabUrl(getPageSlug())) {
      return;
    }

    var navRoot = document.getElementById("global-nav");
    var subNavRoot = document.getElementById("global-subnav");
    var contentTabsRoot = document.getElementById("global-content-tabs");

    initContentTabs(contentTabsRoot);
    initGlobalAccount(document.getElementById("global-account"));
    syncResponsiveNavAlignment();
    bindLinkPrefetch(navRoot);
    bindLinkPrefetch(subNavRoot);
    bindLinkPrefetch(contentTabsRoot);
    scheduleInitialLinkPrefetch();
  }

  window.addEventListener("resize", function () {
    if (_resizeTimer) {
      clearTimeout(_resizeTimer);
    }
    _resizeTimer = setTimeout(function () {
      stabilizeScrollbarLayout();
      syncResponsiveNavAlignment();
    }, 100);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      stabilizeScrollbarLayout();
      initGlobalShell();
    });
    return;
  }

  stabilizeScrollbarLayout();
  initGlobalShell();
})();
