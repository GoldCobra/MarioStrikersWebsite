(function () {
  "use strict";

  var PROFILE_TEMPLATE_URL = "templates/player-profile-popup.html?v=20260429-global-popup-v1";
  var POPUP_OPEN_CLASS = "player-popup-open";

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

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
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

  function toPositiveInt(value) {
    var parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
  }

  function parseCodeLine(lineValue) {
    var text = String(lineValue || "").trim();
    if (!text) {
      return { prefix: "", code: "-" };
    }

    var idx = text.indexOf(":");
    if (idx <= 0) {
      return { prefix: "", code: text };
    }

    return {
      prefix: String(text.slice(0, idx + 1)).trim(),
      code: String(text.slice(idx + 1)).trim() || "-"
    };
  }

  function normalizeDateText(value) {
    var text = String(value || "").trim();
    if (!text) {
      return "";
    }

    var date = new Date(text);
    if (Number.isNaN(date.getTime())) {
      return text;
    }

    return date.toISOString().slice(0, 10);
  }

  function getGameBallIconUrl(gameCode) {
    var code = String(gameCode || "").trim().toLowerCase();
    if (code === "msbl") {
      return "../assets/nav-buttons/sub/msblball.png";
    }
    if (code === "msc") {
      return "../assets/nav-buttons/sub/mscball.png";
    }
    return "../assets/nav-buttons/sub/smsball.png";
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
      throw new Error("Invalid profile popup template.");
    }

    document.body.appendChild(popupRoot);

    popupState.root = popupRoot;
    popupState.slots = readSlotMap(popupRoot);
    popupState.lists = readListMap(popupRoot);

    function requestClose(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      closePopup();
    }

    popupRoot.querySelectorAll("[data-action='popup-close']").forEach(function (node) {
      node.addEventListener("pointerdown", requestClose);
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
          throw new Error("Failed to load player profile template.");
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

    var closeButton = popupState.root.querySelector(".player-popup-close");
    if (closeButton) {
      closeButton.focus();
    }
  }

  function closePopup() {
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

  function setSectionHidden(node, isHidden) {
    var section = node && typeof node.closest === "function"
      ? node.closest(".player-popup-section")
      : null;
    if (section) {
      section.hidden = !!isHidden;
    }
  }

  function hasDisplayText(value) {
    var text = String(value || "").trim();
    return text !== "" && text !== "-";
  }

  function isZeroRecord(value) {
    return /^0\s*-\s*0$/.test(String(value || "").trim());
  }

  function renderCodeLines(listKey, lines) {
    var mount = popupState.lists[listKey];
    if (!mount) {
      return false;
    }

    var rows = Array.isArray(lines)
      ? lines.filter(function (lineValue) {
        return hasDisplayText(lineValue);
      })
      : [];
    if (!rows.length) {
      mount.innerHTML = "";
      setSectionHidden(mount, true);
      return false;
    }

    setSectionHidden(mount, false);
    mount.innerHTML = rows.map(function (lineValue) {
      var parts = parseCodeLine(lineValue);
      var prefixHtml = parts.prefix
        ? '<span class="player-popup-code-prefix">' + escapeHtml(parts.prefix) + "</span>"
        : "";

      return [
        '<div class="player-popup-code-row">',
        prefixHtml,
        '<span class="player-popup-code-value">',
        escapeHtml(parts.code),
        "</span>",
        "</div>"
      ].join("");
    }).join("");
    return true;
  }

  function buildRatingLine(label, value, extraHtml) {
    return [
      '<p class="player-popup-rating-line">',
      '<span class="player-popup-rating-label">', escapeHtml(label), ':</span>',
      '<span class="player-popup-rating-value">', escapeHtml(String(value)), "</span>",
      extraHtml || "",
      "</p>"
    ].join("");
  }

  function buildRatingsMarkup(cards) {
    return cards.map(function (card) {
      var ratingValue = card && card.rating && Number.isFinite(card.rating.rating) ? card.rating.rating : null;
      var setsValue = card && card.rating ? String(card.rating.sets || "") : "";
      var gamesValue = card && card.rating ? String(card.rating.games || "") : "";
      var metricKey = card && card.metricKey ? String(card.metricKey) : "";
      var title = card && card.title ? String(card.title) : "";
      var titleLower = title.toLowerCase();
      var cardClass = "player-popup-rating-card";
      if (titleLower.indexOf("msbl") !== -1) {
        cardClass += " is-msbl-rating";
      } else if (titleLower.indexOf("msc") !== -1) {
        cardClass += " is-msc-rating";
      } else if (titleLower.indexOf("sms") !== -1) {
        cardClass += " is-sms-rating";
      }
      if (isZeroRecord(setsValue) || isZeroRecord(gamesValue)) {
        cardClass += " is-inactive-rating";
      }
      var metricValue = null;
      if (card && card.rating && metricKey && Number.isFinite(card.rating[metricKey])) {
        metricValue = card.rating[metricKey];
      }

      var rankIconHtml = card && card.rating && card.rating.rank_icon_url
        ? '<img class="player-popup-rank-icon" src="' + escapeHtml(card.rating.rank_icon_url) + '" alt="" loading="lazy" aria-hidden="true">'
        : "";
      var lines = [];

      if (ratingValue !== null) {
        lines.push(buildRatingLine("Rating", ratingValue, rankIconHtml));
      } else if (rankIconHtml) {
        lines.push(buildRatingLine("Rank", "", rankIconHtml));
      }
      if (hasDisplayText(setsValue)) {
        lines.push(buildRatingLine("Sets", setsValue));
      }
      if (metricValue !== null) {
        lines.push(buildRatingLine(card.metricLabel, metricValue));
      }
      if (hasDisplayText(gamesValue)) {
        lines.push(buildRatingLine("Games", gamesValue));
      }

      if (!lines.length) {
        return "";
      }

      return [
        '<article class="' + cardClass + '">',
        '<h4 class="player-popup-rating-title">', escapeHtml(title), "</h4>",
        lines.join(""),
        "</article>"
      ].join("");
    }).filter(Boolean).join("");
  }

  function renderAccolades(accolades) {
    var mount = popupState.lists.accolades;
    if (!mount) {
      return false;
    }

    var rows = Array.isArray(accolades) ? accolades : [];
    if (!rows.length) {
      mount.innerHTML = "";
      setSectionHidden(mount, true);
      return false;
    }

    setSectionHidden(mount, false);
    mount.innerHTML = rows.map(function (entry) {
      var ballIcon = getGameBallIconUrl(entry && entry.game_code);
      var medal = String(entry && entry.place_medal || "•").trim() || "•";
      var name = String(entry && entry.tournament_name || "").trim() || "-";
      var date = normalizeDateText(entry && entry.start_date);
      var dateHtml = date ? '<span class="player-popup-accolade-date">' + escapeHtml(date) + "</span>" : "";

      return [
        '<li class="player-popup-accolade-item">',
        '<img class="player-popup-accolade-ball" src="', escapeHtml(ballIcon), '" alt="" aria-hidden="true" loading="lazy">',
        '<span class="player-popup-accolade-medal">', escapeHtml(medal), "</span>",
        '<span class="player-popup-accolade-name">', escapeHtml(name), "</span>",
        dateHtml,
        "</li>"
      ].join("");
    }).join("");
    return true;
  }

  function setTextSlot(slotKey, value) {
    var node = popupState.slots[slotKey];
    if (!node) {
      return;
    }
    node.textContent = String(value || "");
  }

  function renderProfile(profile) {
    var data = profile || {};
    var player = data.player || {};
    var ratings = data.ratings || {};

    setTextSlot("player-name", player.name || "-");

    var flagNode = popupState.slots["player-flag"];
    var countryCode = normalizeCountryCode(player.country);
    if (flagNode) {
      if (countryCode) {
        flagNode.src = getFlagAssetUrl(countryCode);
        flagNode.hidden = false;
      } else {
        flagNode.hidden = true;
        flagNode.removeAttribute("src");
      }
    }

    renderCodeLines("fc-switch", (data.friend_codes && data.friend_codes.switch) || []);
    renderCodeLines("fc-msc-pal", (data.friend_codes && data.friend_codes.msc_pal) || []);
    renderCodeLines("fc-msc-ntsc", (data.friend_codes && data.friend_codes.msc_ntsc) || []);
    renderCodeLines("fc-msc-kor", (data.friend_codes && data.friend_codes.msc_kor) || []);
    renderCodeLines("fc-msc-jpn", (data.friend_codes && data.friend_codes.msc_jpn) || []);

    var resultsSection = popupState.slots["results-section"];
    var resultsLink = popupState.slots["results-link"];
    var resultsUrl = String(player.results_url || "").trim();
    if (resultsSection && resultsLink) {
      if (resultsUrl) {
        resultsLink.href = resultsUrl;
        resultsLink.textContent = resultsUrl;
        resultsSection.hidden = false;
      } else {
        resultsSection.hidden = true;
        resultsLink.removeAttribute("href");
        resultsLink.textContent = "";
      }
    }

    renderAccolades(data.accolades || []);

    var singlesMount = popupState.slots["ratings-grid-singles"];
    var singlesMarkup = "";
    if (singlesMount) {
      singlesMarkup = buildRatingsMarkup([
        { title: "MSBL", rating: ratings.msbl || {}, metricKey: "whr", metricLabel: "WHR" },
        { title: "MSC", rating: ratings.msc || {}, metricKey: "whr", metricLabel: "WHR" },
        { title: "SMS", rating: ratings.sms || {}, metricKey: "whr", metricLabel: "WHR" }
      ]);
      singlesMount.innerHTML = singlesMarkup;
      singlesMount.hidden = !singlesMarkup;
    }

    var doublesMount = popupState.slots["ratings-grid-doubles"];
    var doublesMarkup = "";
    if (doublesMount) {
      doublesMarkup = buildRatingsMarkup([
        { title: "MSBL 2v2", rating: ratings.msbl2v2 || {}, metricKey: "tst", metricLabel: "TST" },
        { title: "MSC 2v2", rating: ratings.msc2v2 || {}, metricKey: "tst", metricLabel: "TST" },
        { title: "SMS 2v2", rating: ratings.sms2v2 || {}, metricKey: "tst", metricLabel: "TST" }
      ]);
      doublesMount.innerHTML = doublesMarkup;
      doublesMount.hidden = !doublesMarkup;
    }

    if (singlesMount || doublesMount) {
      setSectionHidden(singlesMount || doublesMount, !singlesMarkup && !doublesMarkup);
    }

    var rankBannerSection = popupState.slots["rank-banner-section"];
    var rankBanner = popupState.slots["rank-banner"];
    var bannerUrl = String(data.highest_rank_banner_url || "").trim();
    if (rankBannerSection && rankBanner) {
      if (bannerUrl) {
        rankBanner.src = bannerUrl;
        rankBannerSection.hidden = false;
      } else {
        rankBanner.removeAttribute("src");
        rankBannerSection.hidden = true;
      }
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
      statusNode.textContent = String(message || "Failed to load player profile.");
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

  async function fetchPlayers() {
    var base = getApiBase();
    var url = (base || "") + "/api/players";
    var response = await fetch(url, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) {
      throw new Error("Players request failed.");
    }
    var payload = await response.json();
    return Array.isArray(payload && payload.rows) ? payload.rows : [];
  }

  async function fetchPlayerProfile(playerId) {
    var base = getApiBase();
    var url = (base || "") + "/api/players/" + encodeURIComponent(String(playerId)) + "/profile";
    var response = await fetch(url, {
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error("Profile request failed.");
    }

    return response.json();
  }

  function buildRowsHtml(rows) {
    return rows.map(function (row) {
      var name = String(row && row.name || "").trim() || "-";
      var playerId = toPositiveInt(row && row.player_id);
      var countryCode = normalizeCountryCode(row && row.country);
      var flagHtml = countryCode
        ? '<img class="players-flag" src="' + escapeHtml(getFlagAssetUrl(countryCode)) + '" alt="" aria-hidden="true" loading="lazy" onerror="this.onerror=null;this.remove();">'
        : "";

      var nameInnerHtml = playerId
        ? '<button type="button" class="players-name-trigger" data-player-id="' + playerId + '" aria-haspopup="dialog" aria-controls="player-profile-popup" aria-label="Open profile for ' + escapeHtml(name) + '">' + escapeHtml(name) + "</button>"
        : '<span class="players-name-static">' + escapeHtml(name) + "</span>";

      return [
        '<article class="lb-row players-row" role="listitem">',
        '<div class="lb-inner-frame players-inner-frame">',
        '<div class="lb-rank-cell players-flag-cell" aria-hidden="true">',
        '<span class="players-flag-slot">', flagHtml, "</span>",
        "</div>",
        '<span class="lb-player players-name">',
        '<span class="players-name-text">', nameInnerHtml, "</span>",
        "</span>",
        '<div class="lb-points players-points-spacer" aria-hidden="true"></div>',
        "</div>",
        "</article>"
      ].join("");
    }).join("");
  }

  function renderLoading(mount) {
    mount.innerHTML = '<p class="players-note loading-note">Loading...</p>';
  }

  function renderEmpty(mount) {
    mount.innerHTML = '<p class="players-note">No players available.</p>';
  }

  function renderError(mount) {
    mount.innerHTML = '<p class="players-note players-note-error">Failed to load players.</p>';
  }

  async function openPlayerPopup(playerId, openerElement) {
    if (!toPositiveInt(playerId)) {
      return;
    }

    await ensurePopup();
    openPopup(openerElement);

    setTextSlot("player-name", "");
    var staleFlag = popupState.slots["player-flag"];
    if (staleFlag) {
      staleFlag.hidden = true;
      staleFlag.removeAttribute("src");
    }

    var cached = profileCache.get(playerId);
    if (cached) {
      renderProfile(cached);
      renderPopupContent();
      return;
    }

    renderPopupLoading("Loading...");

    var requestToken = Symbol("profile-request");
    popupState.activeRequestToken = requestToken;

    try {
      var profile = await fetchPlayerProfile(playerId);
      if (popupState.activeRequestToken !== requestToken || !popupState.isOpen) {
        return;
      }

      profileCache.set(playerId, profile);
      renderProfile(profile);
      renderPopupContent();
    } catch (_error) {
      if (popupState.activeRequestToken !== requestToken || !popupState.isOpen) {
        return;
      }
      renderPopupError("Failed to load player profile.");
    }
  }

  async function initPlayersPage() {
    var page = String(document.body && document.body.getAttribute("data-page") || "").toLowerCase();
    if (page !== "players") {
      return;
    }

    var mount = document.getElementById("players-root");
    if (!mount) {
      return;
    }

    renderLoading(mount);

    try {
      var rows = await fetchPlayers();
      if (!rows.length) {
        renderEmpty(mount);
        return;
      }

      mount.innerHTML = [
        '<section class="leaderboard-block players-list-block">',
        '<section class="leaderboard-list players-list" role="list" aria-label="Players list">',
        buildRowsHtml(rows),
        "</section>",
        "</section>"
      ].join("");

      mount.addEventListener("click", function (event) {
        var trigger = event.target.closest(".players-name-trigger");
        if (!trigger) {
          return;
        }
        var playerId = toPositiveInt(trigger.getAttribute("data-player-id"));
        if (!playerId) {
          return;
        }
        openPlayerPopup(playerId, trigger);
      });
    } catch (_error) {
      renderError(mount);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPlayersPage);
    return;
  }

  initPlayersPage();
})();
