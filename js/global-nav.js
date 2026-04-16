(function () {
  "use strict";

  var MAIN_NAV_ITEMS = [
    { key: "msl", label: "MSL" },
    { key: "msbl", label: "MSBL" },
    { key: "msc", label: "MSC" },
    { key: "sms", label: "SMS" },
    { key: "partners", label: "PARTNERS" }
  ];

  var EXTERNAL_LINKS = [
    { key: "dsc", label: "Discord", href: "https://discord.gg/de2YaWg" },
    { key: "x", label: "X", href: "https://x.com/MarioStrikersGG" },
    { key: "yt", label: "YouTube", href: "https://www.youtube.com/@MarioStrikersGG" },
    { key: "ttv", label: "Twitch", href: "https://twitch.tv/MarioStrikersGG" }
  ];

  function getPathPrefix() {
    var path = String(window.location.pathname || "").toLowerCase();
    return path.indexOf("/pages/") !== -1 ? ".." : ".";
  }

  function getPageKey() {
    var body = document.body;
    var byDataset = body && body.getAttribute("data-page");
    if (byDataset) {
      return String(byDataset).toLowerCase();
    }

    return String(window.location.pathname || "").split("/").pop().toLowerCase().replace(".html", "");
  }

  function getActiveMainKey(pageKey) {
    if (pageKey.indexOf("msbl") === 0) {
      return "msbl";
    }
    if (pageKey.indexOf("msc") === 0) {
      return "msc";
    }
    if (pageKey.indexOf("sms") === 0) {
      return "sms";
    }
    if (pageKey.indexOf("msl") === 0) {
      return "msl";
    }
    if (pageKey.indexOf("partners") === 0) {
      return "partners";
    }

    return "";
  }

  function buildMainNavHtml(prefix, activeKey) {
    var extHtml = EXTERNAL_LINKS.map(function (link) {
      return [
        '<a class="ext-link" href="', link.href, '" aria-label="', link.label, '" target="_blank" rel="noopener noreferrer">',
        '<img class="ext-icon" src="', prefix, '/assets/ext-links/', link.key, '.png" alt="', link.label, '">',
        '</a>'
      ].join("");
    }).join("");

    var navHtml = MAIN_NAV_ITEMS.map(function (item) {
      var isActive = item.key === activeKey;
      var state = isActive ? "active" : "default";
      var ariaCurrent = isActive ? ' aria-current="page"' : "";

      return [
        '<a class="nav-link" href="', prefix, '/pages/', item.key, '.html" aria-label="', item.label, '"', ariaCurrent, '>',
        '<img class="nav-icon" src="', prefix, '/assets/nav-buttons/', state, '/', item.key, '-', state, '.png" alt="', item.label, '">',
        '</a>'
      ].join("");
    }).join("");

    return [
      '<header id="2">',
      '<nav class="ext-nav" aria-label="External links">', extHtml, '</nav>',
      '<nav class="main-nav" aria-label="Main navigation">', navHtml, '</nav>',
      '</header>'
    ].join("");
  }

  function buildSubIconLink(prefix, href, label, iconFile) {
    return [
      '<a class="sub-link sub-link-icon" href="', prefix, '/pages/', href, '" aria-label="', label, '">',
      '<img class="sub-icon" src="', prefix, '/assets/nav-buttons/sub/', iconFile, '" alt="', label, '">',
      '</a>'
    ].join("");
  }

  function buildSubNavHtml(prefix, pageKey) {
    if (pageKey.indexOf("msbl") === 0) {
      return [
        '<nav class="sub-nav" aria-label="MSBL sub navigation">',
        buildSubIconLink(prefix, "msbl-elo1v1.html", "Leaderboards", "sub-leaderboards.png"),
        buildSubIconLink(prefix, "msbl-competitiverules.html", "Competitive Rules", "sub-competitiverules.png"),
        buildSubIconLink(prefix, "msbl.html", "Gear Builder", "sub-gearbuilder.png"),
        '</nav>'
      ].join("");
    }

    if (pageKey.indexOf("msc") === 0) {
      return [
        '<nav class="sub-nav" aria-label="MSC sub navigation">',
        buildSubIconLink(prefix, "msc-elo1v1.html", "Leaderboards", "sub-leaderboards.png"),
        buildSubIconLink(prefix, "msc-competitiverules.html", "Competitive Rules", "sub-competitiverules.png"),
        '</nav>'
      ].join("");
    }

    if (pageKey.indexOf("sms") === 0) {
      return [
        '<nav class="sub-nav" aria-label="SMS sub navigation">',
        buildSubIconLink(prefix, "sms-elo1v1.html", "Leaderboards", "sub-leaderboards.png"),
        buildSubIconLink(prefix, "sms-competitiverules.html", "Competitive Rules", "sub-competitiverules.png"),
        '</nav>'
      ].join("");
    }

    return "";
  }

  function mountGlobalShell() {
    var prefix = getPathPrefix();
    var pageKey = getPageKey();
    var activeMainKey = getActiveMainKey(pageKey);
    var navRoot = document.getElementById("global-nav");
    var subNavRoot = document.getElementById("global-subnav");

    if (navRoot) {
      navRoot.innerHTML = buildMainNavHtml(prefix, activeMainKey);
    }

    if (subNavRoot) {
      subNavRoot.innerHTML = buildSubNavHtml(prefix, pageKey);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountGlobalShell);
    return;
  }

  mountGlobalShell();
})();
