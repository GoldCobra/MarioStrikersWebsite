(function () {
  "use strict";

  var PROFILE_CACHE_TTL_MS = 30000;
  var POPUP_CLOSE_BLOCK_MS = 500;
  var lastPopupCloseAt = 0;

  var PROFILE_TEMPLATE_URL = "/pages/templates/club-profile-popup.html?v=20260602-club-popup-grid-v1";
  var POPUP_OPEN_CLASS = "popup-open";
  var NO_CLUB_LOGO_URL = "../assets/clubs/no-club-logo.png";
  var ACTIVE_MEMBERS_ICON_URL = "../assets/clubs/members.png";
  var INACTIVE_MEMBERS_ICON_URL = "../assets/clubs/inactive-members.png";
  var FLAG_CODE_ALIASES = Object.freeze({
    "uk": "gb",
    "great britain": "gb",
    "greatbritain": "gb",
    "united kingdom": "gb",
    "unitedkingdom": "gb",
    "england": "gb-eng",
    "eng": "gb-eng",
    "en": "gb-eng",
    "gb-eng": "gb-eng",
    "gbeng": "gb-eng",
    "gb-en": "gb-eng",
    "gben": "gb-eng",
    "scotland": "gb-sct",
    "sct": "gb-sct",
    "sco": "gb-sct",
    "gb-sct": "gb-sct",
    "gbsct": "gb-sct",
    "gb-sco": "gb-sct",
    "gbsco": "gb-sct",
    "wales": "gb-wls",
    "wls": "gb-wls",
    "wal": "gb-wls",
    "gb-wls": "gb-wls",
    "gbwls": "gb-wls",
    "gb-wal": "gb-wls",
    "gbwal": "gb-wls",
    "northern ireland": "gb-nir",
    "northernireland": "gb-nir",
    "nir": "gb-nir",
    "gb-nir": "gb-nir",
    "gbnir": "gb-nir",
    "gb-ni": "gb-nir",
    "gbni": "gb-nir"
  });

  var profileCache = new Map();
  var templateLoadPromise = null;
  var keydownHandlerBound = false;

  var popupState = {
    root: null,
    slots: Object.create(null),
    lists: Object.create(null),
    activeRequestToken: null,
    openerElement: null,
    isOpen: false
  };

  function scaleFitText(el, minPx) {
    if (!el) return;
    el.style.fontSize = '';
    if (el.scrollWidth <= el.clientWidth) return;
    var baseSize = parseFloat(window.getComputedStyle(el).fontSize);
    var ratio = el.clientWidth / el.scrollWidth;
    el.style.fontSize = Math.max(minPx || 7, Math.floor(baseSize * ratio * 10) / 10) + 'px';
  }

  var CLUB_LIST_GEOMETRY_VARS = [
    "--msbl-club-row-pixel-height",
    "--msbl-club-name-slot-top",
    "--msbl-club-name-slot-height",
    "--msbl-club-name-line-height",
    "--msbl-club-meta-slot-top",
    "--msbl-club-meta-slot-height"
  ];

  function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function roundToEvenPixel(value) {
    return Math.max(2, Math.round(value / 2) * 2);
  }

  function setStyleVar(node, name, value) {
    if (!node || node.style.getPropertyValue(name) === value) return;
    node.style.setProperty(name, value);
  }

  function clearClubListGeometryVars(list) {
    if (!list) return;
    for (var i = 0; i < CLUB_LIST_GEOMETRY_VARS.length; i++) {
      list.style.removeProperty(CLUB_LIST_GEOMETRY_VARS[i]);
    }
  }

  function getViewportWidth() {
    return Math.max(
      0,
      document.documentElement && document.documentElement.clientWidth || 0,
      window.innerWidth || 0
    );
  }

  function getClubListSlotMetrics(rowHeight) {
    var isCompactImage = window.matchMedia && window.matchMedia("(max-width: 430px)").matches;
    if (!isCompactImage) {
      return {
        nameTop: Math.round(rowHeight / 2 - 28),
        nameHeight: 28,
        nameLineHeight: 28,
        metaTop: Math.round(rowHeight / 2 + 3),
        metaHeight: 18
      };
    }

    var viewportWidth = getViewportWidth();
    var nameOffset = Math.round(clampNumber(viewportWidth * 0.027, 10, 12));
    var nameHeight = Math.round(clampNumber(viewportWidth * 0.03, 10, 13));
    var metaOffset = Math.round(clampNumber(viewportWidth * 0.0055, 2, 3));
    var metaHeight = Math.round(clampNumber(viewportWidth * 0.02, 7, 9));
    var nameShiftY = 1;
    var metaShiftY = 2;

    return {
      nameTop: Math.round(rowHeight / 2 - nameOffset - nameShiftY),
      nameHeight: nameHeight,
      nameLineHeight: nameHeight,
      metaTop: Math.round(rowHeight / 2 + metaOffset + 1 - metaShiftY),
      metaHeight: metaHeight
    };
  }

  function stabilizeClubListGeometry(mount) {
    var list = mount && mount.querySelector(".msbl-clubs-list");
    var firstRow = list && list.querySelector(".msbl-club-row");
    if (!list || !firstRow) return false;

    var rowStyle = window.getComputedStyle(firstRow);
    if (rowStyle.display !== "block") {
      clearClubListGeometryVars(list);
      return false;
    }

    var rowWidth = firstRow.getBoundingClientRect().width;
    if (!rowWidth || !Number.isFinite(rowWidth)) return false;

    var rowHeight = roundToEvenPixel(rowWidth * 110 / 1600);
    var slots = getClubListSlotMetrics(rowHeight);

    setStyleVar(list, "--msbl-club-row-pixel-height", rowHeight + "px");
    setStyleVar(list, "--msbl-club-name-slot-top", slots.nameTop + "px");
    setStyleVar(list, "--msbl-club-name-slot-height", slots.nameHeight + "px");
    setStyleVar(list, "--msbl-club-name-line-height", slots.nameLineHeight + "px");
    setStyleVar(list, "--msbl-club-meta-slot-top", slots.metaTop + "px");
    setStyleVar(list, "--msbl-club-meta-slot-height", slots.metaHeight + "px");
    return true;
  }

  function createClubListLayoutController(mount, afterLayout) {
    var frameId = null;

    function run() {
      frameId = null;
      stabilizeClubListGeometry(mount);
      if (typeof afterLayout === "function") {
        afterLayout();
      }
    }

    function schedule() {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(run);
    }

    run();
    schedule();

    if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === "function") {
      document.fonts.ready.then(schedule);
    }

    if (window.ResizeObserver) {
      var observer = new ResizeObserver(schedule);
      mount.__msblClubListResizeObserver = observer;
      observer.observe(mount);
      var list = mount.querySelector(".msbl-clubs-list");
      if (list) {
        observer.observe(list);
      }
    } else {
      window.addEventListener("resize", schedule);
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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
        throw new Error("Club request failed.");
      }
      return response.json();
    });
  }

  function toDisplayStatus(status) {
    return String(status || "").trim() || "-";
  }

  function getStatusVariant(statusText) {
    var normalized = String(statusText || "").trim().toLowerCase();
    if (normalized === "invite only") {
      return "invite-only";
    }
    if (normalized === "open to anyone") {
      return "open-to-anyone";
    }
    return "default";
  }

  function getStatusClass(baseClassName, statusText) {
    var base = String(baseClassName || "");
    var variant = getStatusVariant(statusText);
    if (variant === "invite-only") {
      return base + " is-invite-only";
    }
    if (variant === "open-to-anyone") {
      return base + " is-open-to-anyone";
    }
    return base;
  }

  function buildStatusHtml(statusText) {
    var text = String(statusText || "").trim();
    if (!text) {
      return "-";
    }

    if (getStatusVariant(text) === "invite-only") {
      return [
        '<img class="msbl-club-status-icon" src="../assets/clubs/invite-only.png" alt="" aria-hidden="true">',
        '<span class="msbl-club-status-text">', escapeHtml(text), "</span>"
      ].join("");
    }

    return '<span class="msbl-club-status-text">' + escapeHtml(text) + "</span>";
  }

  function isClubActive(row) {
    return !!(row && row.is_active === true);
  }

  function buildMembersHtml(memberCount, isActive) {
    var iconUrl = isActive ? ACTIVE_MEMBERS_ICON_URL : INACTIVE_MEMBERS_ICON_URL;
    return [
      '<img class="msbl-club-members-icon" src="', iconUrl, '" alt="" aria-hidden="true">',
      '<span class="msbl-club-members-text">', escapeHtml(String(memberCount)), "</span>"
    ].join("");
  }

  function buildExtrasText(row) {
    var regions = toTextList(row && row.regions);
    if (!regions.length) {
      regions = toTextList(row && row.region);
    }
    return regions.length ? regions.join(" | ") : "-";
  }

  function buildMetaLineHtml(tag, status, memberCount, extras, isActive) {
    var statusText = toDisplayStatus(status);
    var statusClassName = getStatusClass("msbl-club-meta-item msbl-club-status", statusText);

    return [
      '<span class="msbl-club-meta-item msbl-club-tag-meta">', escapeHtml(tag || "-"), "</span>",
      '<span class="', statusClassName, '">', buildStatusHtml(statusText), "</span>",
      '<span class="msbl-club-meta-item msbl-club-extra">', escapeHtml(extras), "</span>",
      '<span class="msbl-club-meta-item msbl-club-members">', buildMembersHtml(memberCount, isActive), "</span>"
    ].join("");
  }

  function getLogoUrl(row) {
    var raw = String(row && row.logo || "").trim();
    if (!raw) {
      return "";
    }
    if (/^\/(?!\/)/.test(raw)) {
      var base = getApiBase();
      return (base || "") + raw;
    }
    if (!/^https?:\/\//i.test(raw)) {
      return "";
    }
    return raw;
  }

  function getDiscordInviteUrl(row) {
    var raw = String(row && row.discord_server || "").trim();
    if (!raw) {
      return "";
    }

    try {
      var candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "https://" + raw;
      var parsed = new URL(candidate);
      var host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      var pathParts = parsed.pathname.split("/").filter(Boolean);
      var isHttp = parsed.protocol === "http:" || parsed.protocol === "https:";
      if (!isHttp || pathParts.length === 0) {
        return "";
      }
      if (host === "discord.gg") {
        return parsed.href;
      }
      if ((host === "discord.com" || host === "discordapp.com") && pathParts[0].toLowerCase() === "invite" && pathParts[1]) {
        return parsed.href;
      }
    } catch (_error) {
      return "";
    }

    return "";
  }

  function buildLogoHtml(row, fallbackText) {
    var logoUrl = getLogoUrl(row);
    if (!logoUrl) {
      return [
        '<div class="msbl-club-logo-slot">',
        '<img class="msbl-club-logo-img msbl-club-logo-fallback" src="', NO_CLUB_LOGO_URL, '" alt="" aria-hidden="true">',
        "</div>"
      ].join("");
    }
    return [
      '<div class="msbl-club-logo-slot">',
      '<img class="msbl-club-logo-img" src="', escapeHtml(logoUrl), '" alt="', escapeHtml(fallbackText), ' club logo" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src=\'', NO_CLUB_LOGO_URL, '\';this.alt=\'\';this.classList.add(\'msbl-club-logo-fallback\');">',
      "</div>"
    ].join("");
  }

  function toPositiveInt(value) {
    var parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
  }

  function buildRowsHtml(rows) {
    return rows.map(function (row) {
      var clubId = toPositiveInt(row && row.club_id);
      var tag = String(row && row.tag || "").trim();
      var name = String(row && row.name || "").trim();
      var status = String(row && row.status || "").trim();
      var memberCount = Number(row && row.member_count || 0);
      var extras = buildExtrasText(row);
      var active = isClubActive(row);
      var rowClass = active ? "msbl-club-row" : "msbl-club-row is-inactive";
      var interactiveAttrs = clubId
        ? ' data-club-id="' + clubId + '" tabindex="0" aria-label="Open profile for ' + escapeHtml(name || tag || "Club") + '"'
        : "";

      return [
        '<article class="', rowClass, '" role="listitem"', interactiveAttrs, ">",
        buildLogoHtml(row, name || tag || "Club"),
        '<div class="msbl-club-main">',
        '<div class="msbl-club-primary">',
        '<span class="msbl-club-name">', escapeHtml(name || "-"), "</span>",
        "</div>",
        '<div class="msbl-club-meta">',
        buildMetaLineHtml(tag, status, memberCount, extras, active),
        "</div>",
        "</div>",
        "</article>"
      ].join("");
    }).join("");
  }

  function renderLoading(mount) {
    mount.innerHTML = '<p class="msbl-clubs-note loading-note">Loading...</p>';
  }

  function renderEmpty(mount) {
    mount.innerHTML = '<p class="msbl-clubs-note">No clubs available.</p>';
  }

  function renderError(mount) {
    mount.innerHTML = '<p class="msbl-clubs-note msbl-clubs-note-error">Failed to load clubs.</p>';
  }

  async function fetchClubs() {
    var base = getApiBase();
    var url = (base || "") + "/api/clubs/msbl";
    var payload = await fetchJson(url);
    var rows = Array.isArray(payload && payload.rows) ? payload.rows : [];
    return rows
      .filter(function (row) {
        return Number(row && row.member_count || 0) > 0;
      })
      .sort(function (a, b) {
        var activeDiff = Number(isClubActive(b)) - Number(isClubActive(a));
        if (activeDiff !== 0) {
          return activeDiff;
        }
        var memberDiff = Number(b && b.member_count || 0) - Number(a && a.member_count || 0);
        if (memberDiff !== 0) {
          return memberDiff;
        }
        var nameA = String(a && a.name || "").trim().toLowerCase();
        var nameB = String(b && b.name || "").trim().toLowerCase();
        if (nameA !== nameB) {
          return nameA < nameB ? -1 : 1;
        }
        var tagA = String(a && a.tag || "").trim().toLowerCase();
        var tagB = String(b && b.tag || "").trim().toLowerCase();
        if (tagA === tagB) {
          return 0;
        }
        return tagA < tagB ? -1 : 1;
      });
  }

  function readSlotMap(root) {
    var map = Object.create(null);
    root.querySelectorAll("[data-slot]").forEach(function (node) {
      var key = String(node.getAttribute("data-slot") || "").trim();
      if (key) {
        map[key] = node;
      }
    });
    return map;
  }

  function readListMap(root) {
    var map = Object.create(null);
    root.querySelectorAll("[data-list]").forEach(function (node) {
      var key = String(node.getAttribute("data-list") || "").trim();
      if (key) {
        map[key] = node;
      }
    });
    return map;
  }

  function mountPopupTemplate(templateHtml) {
    var wrapper = document.createElement("div");
    wrapper.innerHTML = String(templateHtml || "").trim();

    var popupRoot = wrapper.firstElementChild;
    if (!popupRoot) {
      throw new Error("Invalid club popup template.");
    }

    document.body.appendChild(popupRoot);

    popupState.root = popupRoot;
    popupState.slots = readSlotMap(popupRoot);
    popupState.lists = readListMap(popupRoot);

    function requestClose(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
      }
      closePopup();
    }

    popupRoot.querySelectorAll("[data-action='popup-close']").forEach(function (node) {
      node.addEventListener("click", requestClose);
    });

    popupRoot.addEventListener("click", function (event) {
      var target = event.target;
      if (!target || typeof target.closest !== "function") {
        return;
      }

      var closeTrigger = target.closest("[data-action='popup-close']");
      if (!closeTrigger) {
        return;
      }
      requestClose(event);
    });

    if (!keydownHandlerBound) {
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && popupState.isOpen) {
          closePopup();
        }
      });
      keydownHandlerBound = true;
    }

    return popupRoot;
  }

  async function ensurePopup() {
    if (popupState.root) {
      return popupState.root;
    }

    if (!templateLoadPromise) {
      templateLoadPromise = fetch(PROFILE_TEMPLATE_URL, {
        headers: { Accept: "text/html" }
      }).then(function (response) {
        if (!response.ok) {
          throw new Error("Failed to load club profile template.");
        }
        return response.text();
      }).then(function (html) {
        return mountPopupTemplate(html);
      });
    }

    return templateLoadPromise;
  }

  function openPopup(openerElement) {
    if (!popupState.root) {
      return;
    }

    popupState.openerElement = openerElement || document.activeElement || null;
    popupState.root.hidden = false;
    popupState.root.setAttribute("aria-hidden", "false");
    popupState.isOpen = true;
    document.body.classList.add(POPUP_OPEN_CLASS);

    var closeButton = popupState.root.querySelector(".club-popup-close");
    if (closeButton) {
      closeButton.focus();
    }
  }

  function blockPostCloseInteraction() {
    var timer;
    var blockEvent = function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
    };
    var cleanup = function () {
      document.removeEventListener("click", blockEvent, true);
      document.removeEventListener("pointerup", blockEvent, true);
      document.removeEventListener("touchend", blockEvent, true);
      clearTimeout(timer);
    };

    document.addEventListener("click", blockEvent, true);
    document.addEventListener("pointerup", blockEvent, true);
    document.addEventListener("touchend", blockEvent, true);
    timer = setTimeout(cleanup, POPUP_CLOSE_BLOCK_MS);
  }

  function closePopup() {
    lastPopupCloseAt = Date.now();
    blockPostCloseInteraction();

    if (!popupState.root) {
      return;
    }

    popupState.root.hidden = true;
    popupState.root.setAttribute("aria-hidden", "true");
    popupState.isOpen = false;
    popupState.activeRequestToken = null;
    document.body.classList.remove(POPUP_OPEN_CLASS);

    if (popupState.openerElement && typeof popupState.openerElement.focus === "function") {
      popupState.openerElement.focus();
    }
    popupState.openerElement = null;
  }

  function setTextSlot(slotKey, value) {
    var node = popupState.slots[slotKey];
    if (!node) {
      return;
    }
    node.textContent = String(value || "");
  }

  function toTextList(value) {
    if (Array.isArray(value)) {
      return value.map(function (entry) {
        return String(entry || "").trim();
      }).filter(Boolean);
    }
    var text = String(value || "").trim();
    return text ? [text] : [];
  }

  function getClubRegions(club) {
    var regions = toTextList(club && club.regions);
    return regions.length ? regions : toTextList(club && club.region);
  }

  function getClubCodes(club) {
    var clubCodes = toTextList(club && club.club_codes);
    return clubCodes.length ? clubCodes : toTextList(club && club.club_code);
  }

  function getRegionBadgeClass(regionCode) {
    var normalized = String(regionCode || "").trim().toUpperCase();
    if (normalized === "EU") return "is-eu";
    if (normalized === "NA") return "is-na";
    if (normalized === "SA") return "is-sa";
    if (normalized === "SSA") return "is-ssa";
    if (normalized === "APAC") return "is-apac";
    if (normalized === "OCE") return "is-oce";
    if (normalized === "MENA") return "is-mena";
    if (normalized === "OTHER") return "is-other";
    return "is-unknown";
  }

  function buildRegionBadgesHtml(regions) {
    return toTextList(regions).map(function (region) {
      return '<span class="club-popup-region-badge ' + getRegionBadgeClass(region) + '">' + escapeHtml(region) + "</span>";
    }).join("");
  }

  function setClubRegionBadgesLine(slotKey, regions) {
    var node = popupState.slots[slotKey];
    if (!node) {
      return;
    }

    node.hidden = false;
    var regionValues = toTextList(regions);
    if (!regionValues.length) {
      node.innerHTML = "";
      return;
    }

    node.innerHTML = buildRegionBadgesHtml(regionValues);
  }

  function renderClubInfo(club) {
    var statusNode = popupState.slots["club-line-primary"];
    var status = String(club && club.join_conditions || "").trim();
    if (statusNode) {
      statusNode.hidden = false;
      if (getStatusVariant(status) === "open-to-anyone") {
        var codes = getClubCodes(club);
        if (codes.length) {
          statusNode.textContent = codes.join(" | ");
        } else {
          statusNode.innerHTML = '<span class="' + getStatusClass("club-popup-meta-condition", status) + '">' + buildStatusHtml(status) + "</span>";
        }
      } else {
        statusNode.innerHTML = status
          ? '<span class="' + getStatusClass("club-popup-meta-condition", status) + '">' + buildStatusHtml(status) + "</span>"
          : "-";
      }
    }

    setClubRegionBadgesLine("club-line-regions", getClubRegions(club));
  }

  function setClubDiscordLink(club) {
    var node = popupState.slots["club-discord-link"];
    if (!node) {
      return;
    }

    var url = getDiscordInviteUrl(club);
    if (!url) {
      node.hidden = true;
      node.removeAttribute("href");
      return;
    }

    node.href = url;
    node.hidden = false;
  }

  function formatDate(value) {
    var raw = String(value || "").trim();
    if (!raw) {
      return "";
    }
    var date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toISOString().slice(0, 10);
  }

  function normalizeCountryCode(countryCode) {
    var raw = String(countryCode || "").trim().toLowerCase().replace(/[_\u2013\u2014]/g, "-");
    if (!raw) {
      return "";
    }

    var spaced = raw.replace(/[-\s]+/g, " ").trim();
    var dashed = spaced.replace(/\s+/g, "-");
    var compact = spaced.replace(/\s+/g, "");
    var alias = FLAG_CODE_ALIASES[raw] || FLAG_CODE_ALIASES[spaced] || FLAG_CODE_ALIASES[dashed] || FLAG_CODE_ALIASES[compact];
    if (alias) {
      return alias;
    }
    if (/^[a-z]{2}$/.test(dashed)) {
      return dashed;
    }
    if (/^gb-(eng|wls|sct|nir)$/.test(dashed)) {
      return dashed;
    }
    return "";
  }

  function getFlagAssetUrl(countryCode) {
    return "../assets/flags/" + countryCode + ".png";
  }

  function getCountryDisplayName(countryCode) {
    var helper = window.MSCCountryDisplayNames;
    if (helper && typeof helper.getCountryDisplayName === "function") {
      return helper.getCountryDisplayName(countryCode);
    }
    return "";
  }

  function buildFlagTitleAttr(countryCode) {
    var countryName = getCountryDisplayName(countryCode);
    return countryName ? ' title="' + escapeHtml(countryName) + '"' : "";
  }

  function buildRoleBadgeHtml(role) {
    var normalized = String(role || "").trim().toLowerCase();
    if (normalized === "owner") {
      return '<span class="club-popup-role-badge is-owner"><span class="club-popup-role-label">OWNER</span></span>';
    }
    if (normalized === "officer") {
      return '<span class="club-popup-role-badge is-officer"><span class="club-popup-role-label">OFFICER</span></span>';
    }
    return "";
  }

  function renderRoster(roster) {
    var mount = popupState.lists.roster;
    if (!mount) {
      return;
    }

    var rows = Array.isArray(roster) ? roster : [];
    if (!rows.length) {
      mount.innerHTML = '<li class="club-popup-roster-item is-empty">No roster available.</li>';
      return;
    }

    mount.innerHTML = rows.map(function (row) {
      var countryCode = normalizeCountryCode(row && row.country);
      var flagHtml = countryCode
        ? '<img class="club-popup-roster-flag" src="' + escapeHtml(getFlagAssetUrl(countryCode)) + '" alt="" aria-hidden="true"' + buildFlagTitleAttr(countryCode) + ' loading="lazy" onerror="this.onerror=null;this.remove();">'
        : '<span class="club-popup-roster-flag club-popup-roster-flag-empty" aria-hidden="true"></span>';
      var name = String(row && row.name || "").trim() || "Unknown";
      var discordName = String(row && row.discord_name || "").trim();
      var badgeHtml = buildRoleBadgeHtml(row && row.role);
      var discordNameHtml = discordName
        ? '<span class="club-popup-roster-discord-name">' + escapeHtml(discordName) + "</span>"
        : "";

      return [
        '<li class="club-popup-roster-item">',
        flagHtml,
        '<span class="club-popup-roster-player">',
        '<span class="club-popup-roster-name">', escapeHtml(name), "</span>",
        discordNameHtml,
        "</span>",
        badgeHtml,
        "</li>"
      ].join("");
    }).join("");
  }

  function renderProfile(profile) {
    var data = profile || {};
    var club = data.club || {};
    var roster = Array.isArray(data.roster) ? data.roster : [];

    var name = String(club.name || "").trim() || "-";
    var tag = String(club.tag || "").trim();
    var nameEl = popupState.slots["club-name"];
    if (nameEl) {
      nameEl.innerHTML = tag
        ? escapeHtml(name) + ' <span class="club-popup-tag-label">[' + escapeHtml(tag) + ']</span>'
        : escapeHtml(name);
    }
    renderClubInfo(club);
    setTextSlot("created-date", formatDate(club.created_at));
    setClubDiscordLink(club);

    var logoBgNode = popupState.slots["club-logo-bg"];
    var logoUrl = getLogoUrl(club);
    if (logoBgNode) {
      if (logoUrl) {
        logoBgNode.src = logoUrl;
        logoBgNode.hidden = false;
      } else {
        logoBgNode.hidden = true;
        logoBgNode.removeAttribute("src");
      }
    }

    renderRoster(roster);

    var nameEl = popupState.slots["club-name"];
    if (nameEl) {
      window.requestAnimationFrame(function () { scaleFitText(nameEl, 9); });
    }
  }

  function renderPopupLoading(message) {
    var statusNode = popupState.slots["popup-status"];
    var contentNode = popupState.slots["popup-content"];
    if (statusNode) {
      statusNode.textContent = String(message || "Loading...");
      statusNode.hidden = false;
      statusNode.classList.remove("is-error");
    }
    if (contentNode) {
      contentNode.hidden = true;
    }
  }

  function renderPopupError(message) {
    var statusNode = popupState.slots["popup-status"];
    var contentNode = popupState.slots["popup-content"];
    if (statusNode) {
      statusNode.textContent = String(message || "Failed to load club profile.");
      statusNode.hidden = false;
      statusNode.classList.add("is-error");
    }
    if (contentNode) {
      contentNode.hidden = true;
    }
  }

  function renderPopupContent() {
    var statusNode = popupState.slots["popup-status"];
    var contentNode = popupState.slots["popup-content"];
    if (statusNode) {
      statusNode.hidden = true;
      statusNode.classList.remove("is-error");
    }
    if (contentNode) {
      contentNode.hidden = false;
    }
  }

  async function fetchClubProfile(clubId) {
    var base = getApiBase();
    var url = (base || "") + "/api/clubs/msbl/" + encodeURIComponent(String(clubId)) + "/profile";
    var response = await fetch(url, {
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error("Profile request failed.");
    }

    return response.json();
  }

  async function openClubPopup(clubId, openerElement) {
    var normalizedClubId = toPositiveInt(clubId);
    if (!normalizedClubId) {
      return;
    }

    await ensurePopup();
    openPopup(openerElement);

    setTextSlot("club-name", "");
    renderClubInfo(null);
    setTextSlot("created-date", "");
    setClubDiscordLink(null);
    var staleLogoBg = popupState.slots["club-logo-bg"];
    if (staleLogoBg) {
      staleLogoBg.hidden = true;
      staleLogoBg.removeAttribute("src");
    }

    var cached = profileCache.get(normalizedClubId);
    if (cached && Date.now() - cached.ts < PROFILE_CACHE_TTL_MS) {
      renderProfile(cached.data);
      renderPopupContent();
      return;
    } else if (cached) {
      profileCache.delete(normalizedClubId);
    }

    renderPopupLoading("Loading...");

    var requestToken = Symbol("club-profile-request");
    popupState.activeRequestToken = requestToken;

    try {
      var profile = await fetchClubProfile(normalizedClubId);
      if (popupState.activeRequestToken !== requestToken || !popupState.isOpen) {
        return;
      }

      profileCache.set(normalizedClubId, { data: profile, ts: Date.now() });
      renderProfile(profile);
      renderPopupContent();
    } catch (_error) {
      if (popupState.activeRequestToken !== requestToken || !popupState.isOpen) {
        return;
      }
      renderPopupError("Failed to load club profile.");
    }
  }

  async function initMsblClubsPage() {
    var page = String(document.body && document.body.getAttribute("data-page") || "").toLowerCase();
    if (page !== "msbl-striker-clubs") {
      return;
    }

    var mount = document.getElementById("msbl-clubs-root");
    if (!mount) {
      return;
    }

    renderLoading(mount);

    try {
      var rows = await fetchClubs();
      if (!rows.length) {
        renderEmpty(mount);
        return;
      }

      mount.innerHTML = [
        '<section class="msbl-clubs-list" role="list" aria-label="MSBL clubs list">',
        buildRowsHtml(rows),
        "</section>"
      ].join("");

      function scaleAllClubNames() {
        var nameEls = mount.querySelectorAll('.msbl-club-name');
        for (var i = 0; i < nameEls.length; i++) {
          scaleFitText(nameEls[i], 6);
        }
      }
      createClubListLayoutController(mount, scaleAllClubNames);

      mount.addEventListener("click", function (event) {
        if (Date.now() - lastPopupCloseAt < POPUP_CLOSE_BLOCK_MS) { return; }
        var row = event.target && typeof event.target.closest === "function"
          ? event.target.closest(".msbl-club-row[data-club-id]")
          : null;
        if (!row) {
          return;
        }
        var clubId = toPositiveInt(row.getAttribute("data-club-id"));
        if (!clubId) {
          return;
        }
        openClubPopup(clubId, row);
      });

      mount.addEventListener("keydown", function (event) {
        var row = event.target && typeof event.target.closest === "function"
          ? event.target.closest(".msbl-club-row[data-club-id]")
          : null;
        if (!row) {
          return;
        }
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }
        event.preventDefault();
        var clubId = toPositiveInt(row.getAttribute("data-club-id"));
        if (!clubId) {
          return;
        }
        openClubPopup(clubId, row);
      });
    } catch (_error) {
      renderError(mount);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMsblClubsPage);
    return;
  }

  initMsblClubsPage();
})();
