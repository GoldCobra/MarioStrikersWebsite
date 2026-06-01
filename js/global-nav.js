(function () {
  "use strict";

  var EXTERNAL_LINKS = [
    { label: "Discord", href: "https://discord.gg/de2YaWg" },
    { label: "X", href: "https://x.com/MarioStrikersGG" },
    { label: "YouTube", href: "https://www.youtube.com/@MarioStrikersGG" },
    { label: "Twitch", href: "https://twitch.tv/MarioStrikersGG" }
  ];

  var TOP_NAV_ITEMS = [
    { key: "home", label: "Home", slug: "index" },
    { key: "games", label: "Games", slug: "games" },
    { key: "competitive", label: "Competitive", slug: "competitive" },
    { key: "players", label: "Players", slug: "players" },
    { key: "partners", label: "Partners", slug: "partners" }
  ];
  var preloadedImageMap = Object.create(null);
  var prefetchedHrefMap = Object.create(null);
  var SITE_ORIGIN = "https://mariostrikers.gg";
  var BREADCRUMB_SCRIPT_ID = "global-breadcrumb-jsonld";
  var NOINDEX_PAGE_SLUGS = {
    "competitive-leaderboards": true,
    "competitive-rules": true,
    "competitive-tier-lists": true,
    "competitive-tournaments": true,
    "community-tournaments": true,
    "competitive": true,
    "games": true,
    "msbl": true,
    "msc": true,
    "msl": true,
    "msl-leaderboards": true,
    "players": true,
    "players-profiles": true,
    "profile": true,
    "sms": true,
    "tab-placeholder": true
  };
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

  var SECTION_MODELS = {
    games: {
      overviewSlug: "games",
      label: "Games",
      items: [
        {
          key: "msbl",
          label: "MSBL",
          subnavLabel: "STRIKERS: BATTLE LEAGUE",
          slug: "msbl",
          children: [
            { key: "striker-clubs", label: "Striker Clubs", slug: "msbl-striker-clubs" },
            { key: "gear-builder", label: "Gear Builder", slug: "msbl-gear-builder" },
            { key: "save-editor", label: "Save Editor", slug: "msbl-save-editor" }
          ]
        },
        {
          key: "msc",
          label: "MSC",
          subnavLabel: "STRIKERS CHARGED",
          slug: "msc",
          children: [
            { key: "setup-guide", label: "Setup Guide", slug: "msc-setup-guide" },
            { key: "save-editor", label: "Save Editor", slug: "msc-save-editor" },
            { key: "wiimmfi", label: "WIIMMFI", slug: "msc-wiimmfi", hidden: true }
          ]
        },
        {
          key: "sms",
          label: "SMS",
          subnavLabel: "SUPER MARIO STRIKERS",
          slug: "sms",
          children: [
            { key: "setup-guide", label: "Setup Guide", slug: "sms-setup-guide" }
          ]
        }
      ]
    },
    competitive: {
      overviewSlug: "competitive",
      label: "Competitive",
      items: [
        {
          key: "rules",
          label: "Rules",
          slug: "competitive-rules",
          children: [
            { key: "msbl-rules", label: "MSBL", slug: "msbl-competitiverules" },
            { key: "msc-rules", label: "MSC", slug: "msc-competitiverules" },
            { key: "sms-rules", label: "SMS", slug: "sms-competitiverules" }
          ]
        },
        {
          key: "msl",
          label: "MSL",
          slug: "msl",
          children: [
            { key: "league-rules", label: "League Rules", slug: "msl-league-rules" },
            { key: "league-site", label: "Schedule", slug: "msl-schedule" }
          ]
        },
        {
          key: "tournaments",
          label: "Tournaments",
          slug: "competitive-tournaments",
          children: [
            { key: "community", label: "Community Tournaments", slug: "community-tournaments" }
          ]
        },
        {
          key: "leaderboards",
          label: "Leaderboards",
          slug: "competitive-leaderboards",
          children: [
            { key: "msbl", label: "MSBL", slug: "msbl-elo1v1", matchSlugs: ["msbl-elo1v1", "msbl-elo2v2", "msbl-whr"] },
            { key: "msc", label: "MSC", slug: "msc-elo1v1", matchSlugs: ["msc-elo1v1", "msc-whr"] },
            { key: "sms", label: "SMS", slug: "sms-elo1v1", matchSlugs: ["sms-elo1v1", "sms-whr"] }
          ]
        },
        {
          key: "tier-lists",
          label: "Tier Lists",
          slug: "competitive-tier-lists",
          children: [
            { key: "msbl", label: "MSBL", slug: "msbl-tierlist" },
            { key: "msc", label: "MSC", slug: "msc-tierlist" },
            { key: "sms", label: "SMS", slug: "sms-tierlist" }
          ]
        }
      ]
    },
    players: {
      overviewSlug: "players",
      label: "Players",
      items: []
    }
  };

  var PAGE_CONTEXT_MAP = {
    msbl: { topKey: "games", secondKey: "msbl" },
    "msbl-striker-clubs": { topKey: "games", secondKey: "msbl", leafKey: "striker-clubs" },
    "msbl-gear-builder": { topKey: "games", secondKey: "msbl", leafKey: "gear-builder" },
    "msbl-save-editor": { topKey: "games", secondKey: "msbl", leafKey: "save-editor" },
    "msc": { topKey: "games", secondKey: "msc" },
    "sms": { topKey: "games", secondKey: "sms" },
    "msc-setup-guide": { topKey: "games", secondKey: "msc", leafKey: "setup-guide" },
    "msc-save-editor": { topKey: "games", secondKey: "msc", leafKey: "save-editor" },
    "msc-wiimmfi": { topKey: "games", secondKey: "msc", leafKey: "wiimmfi" },
    "sms-setup-guide": { topKey: "games", secondKey: "sms", leafKey: "setup-guide" },
    "competitive-rules": { topKey: "competitive", secondKey: "rules" },
    "msbl-competitiverules": { topKey: "competitive", secondKey: "rules", leafKey: "msbl-rules" },
    "msc-competitiverules": { topKey: "competitive", secondKey: "rules", leafKey: "msc-rules" },
    "sms-competitiverules": { topKey: "competitive", secondKey: "rules", leafKey: "sms-rules" },
    "msl": { topKey: "competitive", secondKey: "msl" },
    "msl-league-rules": { topKey: "competitive", secondKey: "msl", leafKey: "league-rules" },
    "msl-schedule": { topKey: "competitive", secondKey: "msl", leafKey: "league-site" },
    "competitive-leaderboards": { topKey: "competitive", secondKey: "leaderboards" },
    "msbl-elo1v1": { topKey: "competitive", secondKey: "leaderboards", leafKey: "msbl" },
    "msbl-elo2v2": { topKey: "competitive", secondKey: "leaderboards", leafKey: "msbl" },
    "msbl-whr": { topKey: "competitive", secondKey: "leaderboards", leafKey: "msbl" },
    "msc-elo1v1": { topKey: "competitive", secondKey: "leaderboards", leafKey: "msc" },
    "msc-whr": { topKey: "competitive", secondKey: "leaderboards", leafKey: "msc" },
    "sms-elo1v1": { topKey: "competitive", secondKey: "leaderboards", leafKey: "sms" },
    "sms-whr": { topKey: "competitive", secondKey: "leaderboards", leafKey: "sms" },
    "competitive-tier-lists": { topKey: "competitive", secondKey: "tier-lists" },
    "msbl-tierlist": { topKey: "competitive", secondKey: "tier-lists", leafKey: "msbl" },
    "msc-tierlist": { topKey: "competitive", secondKey: "tier-lists", leafKey: "msc" },
    "sms-tierlist": { topKey: "competitive", secondKey: "tier-lists", leafKey: "sms" },
    "competitive-tournaments": { topKey: "competitive", secondKey: "tournaments" },
    "community-tournaments": { topKey: "competitive", secondKey: "tournaments", leafKey: "community" },
    profile: { topKey: "players" }
  };

  function getPathPrefix() {
    var path = String(window.location.pathname || "").toLowerCase();
    return path.indexOf("/pages/") !== -1 ? ".." : ".";
  }

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

  function getQueryParams() {
    var search = window.location && window.location.search ? window.location.search : "";
    return new URLSearchParams(search);
  }

  function toHref(prefix, slug, query) {
    void prefix;
    var pageSlug = toPageSlug(slug);
    var suffix = query ? "?" + String(query) : "";
    if (!pageSlug || pageSlug === "index") {
      return "/" + suffix;
    }
    return "/" + pageSlug + suffix;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getCurrentReturnTo() {
    return String(window.location.pathname || "/") +
      String(window.location.search || "") +
      String(window.location.hash || "");
  }

  function getDiscordAvatarUrl(user) {
    var userId = String(user && user.id || "").trim();
    var avatar = String(user && user.avatar || "").trim();
    if (!userId || !avatar) {
      return "";
    }
    return "https://cdn.discordapp.com/avatars/" + encodeURIComponent(userId) + "/" + encodeURIComponent(avatar) + ".png?size=64";
  }

  function preloadImage(src) {
    if (!src || preloadedImageMap[src]) {
      return;
    }

    preloadedImageMap[src] = true;
    var image = new Image();
    image.decoding = "async";
    image.src = src;
  }

  function toModernUiAssetPath(src) {
    return String(src || "").replace(/\.png$/i, ".webp");
  }

  function getTopNavIconPngSrc(prefix, itemKey, isActive) {
    return prefix + "/assets/nav-buttons/" + (isActive ? "active" : "default") + "/nav-" + itemKey + (isActive ? "-active" : "") + ".png";
  }

  function getTopNavIconWebpSrc(prefix, itemKey, isActive) {
    return toModernUiAssetPath(getTopNavIconPngSrc(prefix, itemKey, isActive));
  }

  function preloadCriticalUiAssets(prefix, pageState) {
    preloadImage(prefix + "/assets/logo/logo.webp");

    if (!pageState || !pageState.topKey || pageState.topKey === "home" || pageState.topKey === "partners") {
      if (pageState && pageState.topKey) {
        preloadImage(getTopNavIconWebpSrc(prefix, pageState.topKey, true));
      }
      return;
    }

    preloadImage(getTopNavIconWebpSrc(prefix, pageState.topKey, true));
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

  function normalizeLegacyTabUrl(pageSlug) {
    var params = getQueryParams();
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

    var nextUrl = toHref(".", targetSlug, "") + buildNormalizedSearch(params) + String(window.location.hash || "");
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

  function upsertHeadLink(selector, relValue, hrefValue, typeValue, sizesValue) {
    var head = document.head;
    if (!head) {
      return;
    }

    var link = head.querySelector(selector);
    if (!link) {
      link = document.createElement("link");
      head.appendChild(link);
    }

    link.setAttribute("rel", relValue);
    link.setAttribute("href", hrefValue);

    if (typeValue) {
      link.setAttribute("type", typeValue);
    } else {
      link.removeAttribute("type");
    }

    if (sizesValue) {
      link.setAttribute("sizes", sizesValue);
    } else {
      link.removeAttribute("sizes");
    }
  }

  function removeHeadNodeById(nodeId) {
    var head = document.head;
    if (!head) {
      return;
    }

    var node = head.querySelector("#" + nodeId);
    if (node) {
      head.removeChild(node);
    }
  }

  function upsertJsonLdScript(nodeId, payload) {
    var head = document.head;
    if (!head || !payload) {
      return;
    }

    var node = head.querySelector("#" + nodeId);
    if (!node) {
      node = document.createElement("script");
      node.id = nodeId;
      node.type = "application/ld+json";
      head.appendChild(node);
    }

    node.textContent = JSON.stringify(payload, null, 2);
  }

  function ensureGlobalFavicon(prefix) {
    var pngPath = prefix + "/assets/favicon/blball.png";
    var icoPath = prefix + "/assets/favicon/favicon.ico";

    upsertHeadLink('link[rel="icon"][type="image/png"]', "icon", pngPath, "image/png", "32x32");
    upsertHeadLink('link[rel="icon"][type="image/x-icon"]', "icon", icoPath, "image/x-icon", "");
    upsertHeadLink('link[rel="shortcut icon"]', "shortcut icon", icoPath, "image/x-icon", "");
    upsertHeadLink('link[rel="apple-touch-icon"]', "apple-touch-icon", pngPath, "image/png", "");
  }

  function isNoindexPageSlug(pageSlug) {
    return !!NOINDEX_PAGE_SLUGS[String(pageSlug || "").toLowerCase()];
  }

  function hasChildren(item) {
    return Array.isArray(item.children) && item.children.length > 0;
  }

  function childMatchesPage(child, slug) {
    if (child.slug === slug) {
      return true;
    }
    return Array.isArray(child.matchSlugs) && child.matchSlugs.indexOf(slug) !== -1;
  }

  function formatTabLabel(label) {
    return String(label || "")
      .toUpperCase()
      .replace(/(\d)V(\d)/g, "$1v$2");
  }

  function findItemByKey(section, itemKey) {
    if (!section || !Array.isArray(section.items)) {
      return null;
    }

    for (var i = 0; i < section.items.length; i += 1) {
      if (section.items[i].key === itemKey) {
        return section.items[i];
      }
    }

    return null;
  }

  function findChildByKey(item, childKey) {
    if (!item || !Array.isArray(item.children)) {
      return null;
    }

    for (var i = 0; i < item.children.length; i += 1) {
      if (item.children[i].key === childKey) {
        return item.children[i];
      }
    }

    return null;
  }

  function resolvePageStateFromMap(pageSlug) {
    var mapEntry = PAGE_CONTEXT_MAP[pageSlug];
    if (!mapEntry) {
      return null;
    }

    var section = SECTION_MODELS[mapEntry.topKey];
    if (!section) {
      return null;
    }

    var state = {
      pageSlug: pageSlug,
      topKey: mapEntry.topKey,
      section: section,
      secondItem: null,
      leafItem: null
    };

    if (mapEntry.secondKey) {
      state.secondItem = findItemByKey(section, mapEntry.secondKey);
      if (!state.secondItem) {
        return null;
      }
    }

    if (mapEntry.leafKey) {
      state.leafItem = findChildByKey(state.secondItem, mapEntry.leafKey);
      if (!state.leafItem) {
        return null;
      }
    }

    return state;
  }

  function resolvePageState(pageSlug) {
    var state = {
      pageSlug: pageSlug,
      topKey: "",
      section: null,
      secondItem: null,
      leafItem: null
    };

    if (pageSlug === "index") {
      state.topKey = "home";
      return state;
    }

    if (pageSlug === "partners") {
      state.topKey = "partners";
      return state;
    }

    var mappedState = resolvePageStateFromMap(pageSlug);
    if (mappedState) {
      return mappedState;
    }

    var topKeys = Object.keys(SECTION_MODELS);
    for (var i = 0; i < topKeys.length; i += 1) {
      var topKey = topKeys[i];
      var section = SECTION_MODELS[topKey];

      if (section.overviewSlug === pageSlug) {
        state.topKey = topKey;
        state.section = section;
        return state;
      }

      for (var s = 0; s < section.items.length; s += 1) {
        var item = section.items[s];

        if (hasChildren(item)) {
          for (var c = 0; c < item.children.length; c += 1) {
            var child = item.children[c];
            if (childMatchesPage(child, pageSlug)) {
              state.topKey = topKey;
              state.section = section;
              state.secondItem = item;
              state.leafItem = child;
              return state;
            }
          }
        }

        if (item.slug === pageSlug) {
          state.topKey = topKey;
          state.section = section;
          state.secondItem = item;
          return state;
        }
      }
    }

    if (pageSlug.indexOf("msbl") === 0 || pageSlug.indexOf("msc") === 0 || pageSlug.indexOf("sms") === 0) {
      state.topKey = "games";
      state.section = SECTION_MODELS.games;
      return state;
    }

    if (
      pageSlug.indexOf("msl") === 0 ||
      pageSlug.indexOf("community-tournaments") === 0 ||
      pageSlug.indexOf("competitiverules") !== -1
    ) {
      state.topKey = "competitive";
      state.section = SECTION_MODELS.competitive;
      return state;
    }

    if (pageSlug.indexOf("players-") === 0) {
      state.topKey = "players";
      state.section = SECTION_MODELS.players;
      return state;
    }

    state.topKey = "home";
    return state;
  }

  function getCurrentPageLabel() {
    var title = String(document.title || "").trim();
    if (!title) {
      return "Home";
    }
    return title.split("|")[0].trim() || "Home";
  }

  function toAbsolutePageUrl(slug) {
    var pageSlug = toPageSlug(slug);
    if (!pageSlug || pageSlug === "index") {
      return SITE_ORIGIN + "/";
    }
    return SITE_ORIGIN + "/" + pageSlug;
  }

  function pushBreadcrumb(items, name, slug) {
    if (!name || !slug) {
      return;
    }

    var url = toAbsolutePageUrl(slug);
    if (items.length && items[items.length - 1].item === url) {
      return;
    }

    items.push({
      "@type": "ListItem",
      position: items.length + 1,
      name: String(name),
      item: url
    });
  }

  function buildBreadcrumbItems(pageState) {
    if (!pageState || isNoindexPageSlug(pageState.pageSlug)) {
      return null;
    }

    var items = [];
    pushBreadcrumb(items, "Home", "index");

    if (pageState.pageSlug === "index") {
      return items;
    }

    if (pageState.topKey === "partners") {
      pushBreadcrumb(items, "Partners", "partners");
      return items;
    }

    if (!pageState.section) {
      pushBreadcrumb(items, getCurrentPageLabel(), pageState.pageSlug);
      return items;
    }

    pushBreadcrumb(items, pageState.section.label, pageState.section.overviewSlug);

    if (pageState.secondItem) {
      pushBreadcrumb(items, pageState.secondItem.label, pageState.secondItem.slug);
    }

    if (pageState.leafItem) {
      pushBreadcrumb(items, pageState.leafItem.label, pageState.leafItem.slug);
    }

    if (!items.length || items[items.length - 1].item !== toAbsolutePageUrl(pageState.pageSlug)) {
      pushBreadcrumb(items, getCurrentPageLabel(), pageState.pageSlug);
    }

    return items;
  }

  function ensureBreadcrumbJsonLd(pageState) {
    var breadcrumbItems = buildBreadcrumbItems(pageState);
    if (!breadcrumbItems || breadcrumbItems.length === 0) {
      removeHeadNodeById(BREADCRUMB_SCRIPT_ID);
      return;
    }

    upsertJsonLdScript(BREADCRUMB_SCRIPT_ID, {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: breadcrumbItems
    });
  }

  function sectionForTopKey(topKey) {
    return SECTION_MODELS[topKey] || null;
  }

  function resolveTopNavTargetSlug(item, pageState) {
    void pageState;
    return item.slug;
  }

  function buildTopNavAnchor(prefix, item, pageState, isActive, isCurrent) {
    var targetSlug = resolveTopNavTargetSlug(item, pageState);
    var fallbackIconSrc = getTopNavIconPngSrc(prefix, item.key, isActive);
    var iconSrc = getTopNavIconWebpSrc(prefix, item.key, isActive);
    return [
      '<a class="nav-top-link', isActive ? " is-active" : "", '" href="', toHref(prefix, targetSlug), '" data-top-key="', item.key, '" aria-label="', item.label, '"',
      isCurrent ? ' aria-current="page"' : "",
      ">",
      '<img class="nav-top-icon" src="', iconSrc, '" width="733" height="198" alt="', item.label, '" onerror="this.onerror=null;this.src=\'', fallbackIconSrc, '\'">',
      "</a>"
    ].join("");
  }

  function buildSubNavAnchor(prefix, section, item, isActive, isCurrent) {
    var label = item.subnavLabel || item.label;
    void section;
    var href = toHref(prefix, item.slug, "");

    return [
      '<a class="sub-link sub-link-text', isActive ? " is-active" : "", '" href="', href, '" aria-label="', label, '"',
      isCurrent ? ' aria-current="page"' : "",
      '><span class="sub-link-label">', label, "</span></a>"
    ].join("");
  }

  function buildGlobalTab(prefix, child, isCurrent) {
    if (!child.slug) {
      return "";
    }

    return [
      '<a class="global-tab', isCurrent ? " is-active" : "", '" href="', toHref(prefix, child.slug), '" aria-label="', child.label, '"',
      isCurrent ? ' aria-current="page"' : "",
      ">", formatTabLabel(child.label), "</a>"
    ].join("");
  }

  function buildAccountShellHtml() {
    return [
      '<div id="global-account" class="global-account" data-auth-state="loading"></div>'
    ].join("");
  }

  function buildMainNavHtml(prefix, pageState) {
    var brandHtml = [
      '<a class="nav-brand" href="', toHref(prefix, "index"), '" aria-label="Mario Strikers Community home">',
      '<img class="nav-brand-logo" src="', prefix, '/assets/logo/logo.webp" width="2172" height="1454" alt="Mario Strikers Community" onerror="this.onerror=null;this.src=\'', prefix, '/assets/logo/logo.png\'">',
      '<span class="nav-brand-est">EST. 2017</span>',
      "</a>"
    ].join("");

    var navHtml = TOP_NAV_ITEMS.map(function (item) {
      var isTopActive = pageState.topKey === item.key;
      var isCurrent = pageState.pageSlug === item.slug && (item.key === "home" || item.key === "partners");
      return buildTopNavAnchor(prefix, item, pageState, isTopActive, isCurrent);
    }).join("");

    return [
      '<header id="2">',
      brandHtml,
      '<nav class="main-nav main-nav-text" aria-label="Main navigation">', navHtml, "</nav>",
      buildAccountShellHtml(),
      "</header>"
    ].join("");
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

  function renderSecondLevel(prefix, pageState) {
    var section = pageState.section || sectionForTopKey(pageState.topKey);
    if (!section || !Array.isArray(section.items) || section.items.length === 0) {
      return "";
    }

    var links = section.items.map(function (item) {
      var isCurrent = pageState.pageSlug === item.slug;
      var isActive = !!(pageState.secondItem && pageState.secondItem.key === item.key) || isCurrent;
      return buildSubNavAnchor(prefix, section, item, isActive, isCurrent);
    }).join("");

    return [
      '<nav class="sub-nav sub-nav-level2" aria-label="', section.label, ' navigation">', links, "</nav>"
    ].join("");
  }

  function resolveContentTabsParent(pageState) {
    if (pageState.secondItem && hasChildren(pageState.secondItem)) {
      return pageState.secondItem;
    }
    return null;
  }

  function buildContentTabsHtml(prefix, pageState) {
    var parent = resolveContentTabsParent(pageState);
    if (!parent || !hasChildren(parent)) {
      return "";
    }
    if (pageState.topKey === "competitive" && parent.key === "leaderboards") {
      return "";
    }

    var tabs = parent.children.filter(function (child) {
      return !child.hidden;
    }).map(function (child) {
      return buildGlobalTab(prefix, child, childMatchesPage(child, pageState.pageSlug));
    }).join("");

    return [
      '<section class="global-tabs-shell" aria-label="', parent.label, ' tabs">',
      '<div class="global-tabs-list">', tabs, "</div>",
      "</section>"
    ].join("");
  }

  function buildSubNavHtml(prefix, pageState) {
    if (!pageState.section && !sectionForTopKey(pageState.topKey)) {
      return "";
    }
    return renderSecondLevel(prefix, pageState);
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

  function mountGlobalFooter(prefix) {
    if (!document.body || document.getElementById("global-footer")) {
      return;
    }
    var footer = document.createElement("footer");
    footer.id = "global-footer";

    var disclaimer = document.createElement("p");
    disclaimer.className = "global-footer-disclaimer";
    disclaimer.textContent = "This website is not affiliated with Nintendo. All product names, logos, and brands are property of their respective owners.";
    footer.appendChild(disclaimer);

    var links = document.createElement("p");
    links.className = "global-footer-links";

    function appendSeparator() {
      if (!links.firstChild) {
        return;
      }
      var sep = document.createElement("span");
      sep.className = "global-footer-sep";
      sep.textContent = "–";
      links.appendChild(sep);
    }

    function appendFooterLink(label, href, isExternal) {
      appendSeparator();
      var anchor = document.createElement("a");
      anchor.href = href;
      anchor.className = "global-footer-link";
      anchor.textContent = label;
      if (isExternal) {
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
      }
      links.appendChild(anchor);
    }

    EXTERNAL_LINKS.forEach(function (link) {
      appendFooterLink(String(link.label || "").toUpperCase(), link.href, true);
    });
    appendFooterLink("ABOUT US", toHref(prefix, "about-us"), false);
    appendFooterLink("PRIVACY POLICY", toHref(prefix, "privacy-policy"), false);

    footer.appendChild(links);
    document.body.appendChild(footer);
  }

  function renderGlobalShell(prefix, pageState, navRoot, subNavRoot, contentTabsRoot) {
    if (navRoot) {
      navRoot.innerHTML = buildMainNavHtml(prefix, pageState);
    }

    if (subNavRoot) {
      subNavRoot.innerHTML = buildSubNavHtml(prefix, pageState);
    }

    if (contentTabsRoot) {
      contentTabsRoot.innerHTML = buildContentTabsHtml(prefix, pageState);
      initContentTabs(contentTabsRoot);
    }

    if (document.body) {
      var hasSubnavContent = !!(subNavRoot && subNavRoot.innerHTML && subNavRoot.innerHTML.trim());
      document.body.setAttribute("data-subnav", hasSubnavContent ? "on" : "off");
    }

    mountGlobalFooter(prefix);
    initGlobalAccount(document.getElementById("global-account"));
    syncResponsiveNavAlignment();
    bindLinkPrefetch(navRoot);
    bindLinkPrefetch(subNavRoot);
    bindLinkPrefetch(contentTabsRoot);
    scheduleInitialLinkPrefetch();
  }

  var _resizeTimer = null;

  function stabilizeScrollbarLayout() {
    var sbw = window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.style.setProperty("--sbw", sbw + "px");
    document.documentElement.style.paddingRight = "";
  }

  function mountGlobalShell() {
    var pageSlug = getPageSlug();
    if (normalizeLegacyTabUrl(pageSlug)) {
      return;
    }

    var prefix = getPathPrefix();
    var pageState = resolvePageState(pageSlug);
    ensureGlobalFavicon(prefix);
    preloadCriticalUiAssets(prefix, pageState);
    ensureBreadcrumbJsonLd(pageState);
    var navRoot = document.getElementById("global-nav");
    var subNavRoot = document.getElementById("global-subnav");
    var pageContentRoot = document.querySelector("main.page-content");
    var contentTabsRoot = null;

    if (pageContentRoot) {
      contentTabsRoot = document.createElement("div");
      contentTabsRoot.id = "global-content-tabs";
      var firstMainElement = pageContentRoot.firstElementChild;
      if (firstMainElement && firstMainElement.classList.contains("visually-hidden")) {
        pageContentRoot.insertBefore(contentTabsRoot, firstMainElement.nextSibling);
      } else {
        pageContentRoot.insertBefore(contentTabsRoot, pageContentRoot.firstChild);
      }
    }

    renderGlobalShell(prefix, pageState, navRoot, subNavRoot, contentTabsRoot);
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
      mountGlobalShell();
    });
    return;
  }

  stabilizeScrollbarLayout();
  mountGlobalShell();
})();
