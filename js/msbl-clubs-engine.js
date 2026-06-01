(function () {
  "use strict";

  var PROFILE_CACHE_TTL_MS = 30000;
  var POPUP_CLOSE_BLOCK_MS = 500;
  var lastPopupCloseAt = 0;

  var PROFILE_TEMPLATE_URL = "/pages/templates/club-profile-popup.html?v=20260601-club-profile-discord-v1";
  var POPUP_OPEN_CLASS = "popup-open";
  var NO_CLUB_LOGO_URL = "../assets/clubs/no-club-logo.png";
  var ACTIVE_MEMBERS_ICON_URL = "../assets/clubs/members.png";
  var INACTIVE_MEMBERS_ICON_URL = "../assets/clubs/inactive-members.png";

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

  function buildClubProfileMetaHtml(club) {
    var condition = String(club && club.join_conditions || "").trim();
    var region = String(club && club.region || "").trim();
    var code = String(club && club.club_code || "").trim();
    var parts = [];

    if (condition) {
      parts.push(
        '<span class="' + getStatusClass("club-popup-meta-condition", condition) + '">' +
          buildStatusHtml(condition) +
        "</span>"
      );
    }
    if (region) {
      parts.push('<span class="club-popup-meta-extra">' + escapeHtml(region) + "</span>");
    }
    if (code) {
      parts.push('<span class="club-popup-meta-extra">' + escapeHtml(code) + "</span>");
    }

    return parts.join('<span class="club-popup-meta-separator" aria-hidden="true">|</span>');
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
    var region = String(row && row.region || "").trim();
    var code = String(row && row.club_code || "").trim();
    if (region && code) {
      return region + " / " + code;
    }
    if (region) {
      return region;
    }
    if (code) {
      return code;
    }
    return "-";
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

  function setClubProfileMetaSlot(slotKey, club) {
    var node = popupState.slots[slotKey];
    if (!node) {
      return;
    }

    node.classList.remove("is-invite-only", "is-open-to-anyone");
    node.innerHTML = buildClubProfileMetaHtml(club);
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
      return "-";
    }
    var date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      return "-";
    }
    return date.toISOString().slice(0, 10);
  }

  function normalizeCountryCode(countryCode) {
    var code = String(countryCode || "").trim().toLowerCase();
    if (!/^[a-z]{2}$/.test(code)) {
      return "";
    }
    return code;
  }

  function getFlagAssetUrl(countryCode) {
    return "../assets/flags/" + countryCode + ".png";
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
        ? '<img class="club-popup-roster-flag" src="' + escapeHtml(getFlagAssetUrl(countryCode)) + '" alt="" aria-hidden="true" loading="lazy" onerror="this.onerror=null;this.remove();">'
        : '<span class="club-popup-roster-flag club-popup-roster-flag-empty" aria-hidden="true"></span>';
      var name = String(row && row.name || "").trim() || "Unknown";
      var badgeHtml = buildRoleBadgeHtml(row && row.role);

      return [
        '<li class="club-popup-roster-item">',
        flagHtml,
        '<span class="club-popup-roster-name">', escapeHtml(name), "</span>",
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
    setClubProfileMetaSlot("join-conditions", club);
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
    setTextSlot("join-conditions", "");
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
      window.requestAnimationFrame(scaleAllClubNames);
      if (document.fonts && typeof document.fonts.ready === 'object') {
        document.fonts.ready.then(scaleAllClubNames);
      }

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
