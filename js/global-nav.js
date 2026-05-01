(function () {
  "use strict";

  var EXTERNAL_LINKS = [
    { key: "dsc", label: "Discord", href: "https://discord.gg/de2YaWg" },
    { key: "x", label: "X", href: "https://x.com/MarioStrikersGG" },
    { key: "yt", label: "YouTube", href: "https://www.youtube.com/@MarioStrikersGG" },
    { key: "ttv", label: "Twitch", href: "https://twitch.tv/MarioStrikersGG" }
  ];

  var TOP_NAV_ITEMS = [
    { key: "home", label: "Home", slug: "index" },
    { key: "games", label: "Games", slug: "games" },
    { key: "competitive", label: "Competitive", slug: "competitive" },
    { key: "players", label: "Players", slug: "players" },
    { key: "partners", label: "Partners", slug: "partners" }
  ];
  var LEADERBOARD_BALL_ICONS = ["msblball.png", "mscball.png", "smsball.png"];
  var preloadedImageMap = Object.create(null);

  var SECTION_MODELS = {
    games: {
      overviewSlug: "games",
      label: "Games",
      items: [
        {
          key: "msbl",
          label: "Strikers: Battle League",
          slug: "msbl",
          children: [
            { key: "striker-clubs", label: "Striker Clubs", slug: "players-msbl-clubs" },
            { key: "gear-builder", label: "Gear Builder", slug: "msbl" },
            { key: "save-editor", label: "Save Editor", slug: "msbl-save-editor" }
          ]
        },
        {
          key: "msc",
          label: "Strikers Charged",
          slug: "msc",
          children: [
            { key: "setup-guide", label: "Setup Guide", slug: "msc-setup-guide" },
            { key: "save-editor", label: "Save Editor", slug: "msc-save-editor" }
          ]
        },
        {
          key: "sms",
          label: "Super Mario Strikers",
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
          slug: "msbl-competitiverules",
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
            { key: "league-site", label: "Schedule", slug: "msl-league-site" }
          ]
        },
        {
          key: "tournaments",
          label: "Tournaments",
          slug: "community-tournaments",
          children: [
            { key: "community", label: "Community Tournaments", slug: "community-tournaments" }
          ]
        },
        {
          key: "leaderboards",
          label: "Leaderboards",
          slug: "msbl-elo1v1",
          children: [
            { key: "msbl", label: "MSBL", slug: "msbl-elo1v1", matchSlugs: ["msbl-elo1v1", "msbl-elo2v2", "msbl-whr"] },
            { key: "msc", label: "MSC", slug: "msc-elo1v1", matchSlugs: ["msc-elo1v1", "msc-whr"] },
            { key: "sms", label: "SMS", slug: "sms-elo1v1", matchSlugs: ["sms-elo1v1", "sms-whr"] }
          ]
        },
        {
          key: "tier-lists",
          label: "Tier Lists",
          slug: "msbl-tier-lists",
          children: [
            { key: "msbl", label: "MSBL", slug: "msbl-tier-lists" },
            { key: "msc", label: "MSC", slug: "msc-tier-lists" },
            { key: "sms", label: "SMS", slug: "sms-tier-lists" }
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
    "players-msbl-clubs": { topKey: "games", secondKey: "msbl", leafKey: "striker-clubs" },
    "msbl": { topKey: "games", secondKey: "msbl", leafKey: "gear-builder" },
    "msbl-save-editor": { topKey: "games", secondKey: "msbl", leafKey: "save-editor" },
    "msc": { topKey: "games", secondKey: "msc" },
    "sms": { topKey: "games", secondKey: "sms" },
    "msc-setup-guide": { topKey: "games", secondKey: "msc", leafKey: "setup-guide" },
    "msc-save-editor": { topKey: "games", secondKey: "msc", leafKey: "save-editor" },
    "sms-setup-guide": { topKey: "games", secondKey: "sms", leafKey: "setup-guide" },
    "msbl-competitiverules": { topKey: "competitive", secondKey: "rules", leafKey: "msbl-rules" },
    "msc-competitiverules": { topKey: "competitive", secondKey: "rules", leafKey: "msc-rules" },
    "sms-competitiverules": { topKey: "competitive", secondKey: "rules", leafKey: "sms-rules" },
    "msl": { topKey: "competitive", secondKey: "msl" },
    "msl-league-rules": { topKey: "competitive", secondKey: "msl", leafKey: "league-rules" },
    "msl-league-site": { topKey: "competitive", secondKey: "msl", leafKey: "league-site" },
    "msbl-elo1v1": { topKey: "competitive", secondKey: "leaderboards", leafKey: "msbl" },
    "msbl-elo2v2": { topKey: "competitive", secondKey: "leaderboards", leafKey: "msbl" },
    "msbl-whr": { topKey: "competitive", secondKey: "leaderboards", leafKey: "msbl" },
    "msc-elo1v1": { topKey: "competitive", secondKey: "leaderboards", leafKey: "msc" },
    "msc-whr": { topKey: "competitive", secondKey: "leaderboards", leafKey: "msc" },
    "sms-elo1v1": { topKey: "competitive", secondKey: "leaderboards", leafKey: "sms" },
    "sms-whr": { topKey: "competitive", secondKey: "leaderboards", leafKey: "sms" },
    "msbl-tier-lists": { topKey: "competitive", secondKey: "tier-lists", leafKey: "msbl" },
    "msc-tier-lists": { topKey: "competitive", secondKey: "tier-lists", leafKey: "msc" },
    "sms-tier-lists": { topKey: "competitive", secondKey: "tier-lists", leafKey: "sms" },
    "community-tournaments": { topKey: "competitive", secondKey: "tournaments", leafKey: "community" }
  };

  function getPathPrefix() {
    var path = String(window.location.pathname || "").toLowerCase();
    return path.indexOf("/pages/") !== -1 ? ".." : ".";
  }

  function toPageSlug(raw) {
    return String(raw || "").toLowerCase().replace(".html", "");
  }

  function getPageSlug() {
    var body = document.body;
    var byDataset = body && body.getAttribute("data-page");
    if (byDataset) {
      return toPageSlug(byDataset);
    }

    return toPageSlug(String(window.location.pathname || "").split("/").pop());
  }

  function getQueryParams() {
    var search = window.location && window.location.search ? window.location.search : "";
    return new URLSearchParams(search);
  }

  function getForcedSecondKey() {
    var params = getQueryParams();
    return String(params.get("submenu") || "").trim().toLowerCase();
  }

  function toHref(prefix, slug, query) {
    var suffix = query ? "?" + String(query) : "";
    if (slug === "index") {
      return prefix + "/index.html" + suffix;
    }
    return prefix + "/pages/" + slug + ".html" + suffix;
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

  function preloadGlobalUiAssets(prefix) {
    preloadImage(prefix + "/assets/logo/logo.png");

    TOP_NAV_ITEMS.forEach(function (item) {
      preloadImage(prefix + "/assets/nav-buttons/default/nav-" + item.key + ".png");
      preloadImage(prefix + "/assets/nav-buttons/active/nav-" + item.key + "-active.png");
    });

    EXTERNAL_LINKS.forEach(function (link) {
      preloadImage(prefix + "/assets/ext-links/" + link.key + ".png");
    });

    LEADERBOARD_BALL_ICONS.forEach(function (iconFile) {
      preloadImage(prefix + "/assets/nav-buttons/sub/" + iconFile);
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

  function ensureGlobalFavicon(prefix) {
    var pngPath = prefix + "/assets/favicon/blball.png";
    var icoPath = prefix + "/assets/favicon/favicon.ico";

    upsertHeadLink('link[rel="icon"][type="image/png"]', "icon", pngPath, "image/png", "32x32");
    upsertHeadLink('link[rel="icon"][type="image/x-icon"]', "icon", icoPath, "image/x-icon", "");
    upsertHeadLink('link[rel="shortcut icon"]', "shortcut icon", icoPath, "image/x-icon", "");
    upsertHeadLink('link[rel="apple-touch-icon"]', "apple-touch-icon", pngPath, "image/png", "");
  }

  function isTabsParentView() {
    var params = getQueryParams();
    return params.get("tabs") === "none";
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

  function sectionForTopKey(topKey) {
    return SECTION_MODELS[topKey] || null;
  }

  function resolveTopNavTargetSlug(item, pageState) {
    void pageState;
    return item.slug;
  }

  function buildTopNavAnchor(prefix, item, pageState, isActive, isCurrent) {
    var targetSlug = resolveTopNavTargetSlug(item, pageState);
    var defaultIconSrc = prefix + "/assets/nav-buttons/default/nav-" + item.key + ".png";
    var iconSrc = isActive
      ? prefix + "/assets/nav-buttons/active/nav-" + item.key + "-active.png"
      : defaultIconSrc;
    return [
      '<a class="nav-top-link', isActive ? " is-active" : "", '" href="', toHref(prefix, targetSlug), '" data-top-key="', item.key, '" aria-label="', item.label, '"',
      isCurrent ? ' aria-current="page"' : "",
      ">",
      '<img class="nav-top-icon" src="', iconSrc, '" alt="', item.label, '" onerror="this.onerror=null;this.src=\'', defaultIconSrc, '\'">',
      "</a>"
    ].join("");
  }

  function buildSubNavAnchor(prefix, section, item, isActive, isCurrent) {
    var label = item.label;
    var slug = item.slug;
    var hasChildTabs = hasChildren(item);
    var href = toHref(prefix, slug, "");

    if (
      hasChildTabs &&
      section &&
      section.overviewSlug &&
      section.overviewSlug === "competitive" &&
      item.key === "leaderboards"
    ) {
      var leaderboardEntrySlug = "";
      for (var i = 0; i < item.children.length; i += 1) {
        var child = item.children[i];
        if (child.slug) {
          leaderboardEntrySlug = child.slug;
          break;
        }
      }
      if (leaderboardEntrySlug) {
        href = toHref(prefix, leaderboardEntrySlug, "tabs=none");
      }
    } else if (hasChildTabs && section && section.overviewSlug) {
      href = toHref(
        prefix,
        section.overviewSlug,
        "submenu=" + encodeURIComponent(item.key) + "&tabs=none"
      );
    }

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

  function buildMainNavHtml(prefix, pageState) {
    var extHtml = EXTERNAL_LINKS.map(function (link) {
      return [
        '<a class="ext-link" href="', link.href, '" aria-label="', link.label, '" target="_blank" rel="noopener noreferrer">',
        '<img class="ext-icon" src="', prefix, "/assets/ext-links/", link.key, '.png" alt="', link.label, '">',
        "</a>"
      ].join("");
    }).join("");

    var brandHtml = [
      '<a class="nav-brand" href="', toHref(prefix, "index"), '" aria-label="Mario Strikers Community home">',
      '<img class="nav-brand-logo" src="', prefix, '/assets/logo/logo.png" alt="Mario Strikers Community">',
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
      '<nav class="ext-nav" aria-label="External links">', extHtml, "</nav>",
      '<nav class="main-nav main-nav-text" aria-label="Main navigation">', navHtml, "</nav>",
      "</header>"
    ].join("");
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

    var suppressAutoActive = isTabsParentView() && pageState.secondItem && pageState.secondItem.key === parent.key;
    var tabs = parent.children.map(function (child) {
      var isCurrent = !suppressAutoActive && childMatchesPage(child, pageState.pageSlug);
      return buildGlobalTab(prefix, child, isCurrent);
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

    var aboutLink = document.createElement("a");
    aboutLink.href = toHref(prefix, "about-us");
    aboutLink.className = "global-footer-link";
    aboutLink.textContent = "ABOUT US";
    links.appendChild(aboutLink);

    var sep = document.createElement("span");
    sep.className = "global-footer-sep";
    sep.textContent = "  –  ";
    links.appendChild(sep);

    var privacyLink = document.createElement("a");
    privacyLink.href = toHref(prefix, "privacy-policy");
    privacyLink.className = "global-footer-link";
    privacyLink.textContent = "PRIVACY POLICY";
    links.appendChild(privacyLink);

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
  }

  var _resizeTimer = null;

  function stabilizeScrollbarLayout() {
    var sbw = window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.style.setProperty("--sbw", sbw + "px");
    document.documentElement.style.paddingRight = "";
  }

  function mountGlobalShell() {
    var prefix = getPathPrefix();
    ensureGlobalFavicon(prefix);
    preloadGlobalUiAssets(prefix);
    var pageSlug = getPageSlug();
    var pageState = resolvePageState(pageSlug);
    var forcedSecondKey = getForcedSecondKey();
    if (forcedSecondKey && pageState.section) {
      var forcedSecondItem = findItemByKey(pageState.section, forcedSecondKey);
      if (forcedSecondItem && hasChildren(forcedSecondItem)) {
        pageState.secondItem = forcedSecondItem;
        pageState.leafItem = null;
      }
    }
    var navRoot = document.getElementById("global-nav");
    var subNavRoot = document.getElementById("global-subnav");
    var pageContentRoot = document.querySelector("main.page-content");
    var contentTabsRoot = null;

    if (pageContentRoot) {
      contentTabsRoot = document.createElement("div");
      contentTabsRoot.id = "global-content-tabs";
      pageContentRoot.insertBefore(contentTabsRoot, pageContentRoot.firstChild);
    }

    renderGlobalShell(prefix, pageState, navRoot, subNavRoot, contentTabsRoot);
  }

  window.addEventListener("resize", function () {
    if (_resizeTimer) {
      clearTimeout(_resizeTimer);
    }
    _resizeTimer = setTimeout(stabilizeScrollbarLayout, 100);
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
