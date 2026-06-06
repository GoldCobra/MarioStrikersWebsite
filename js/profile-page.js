(function () {
  "use strict";

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

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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

  function getGameBallIconUrl(gameCode) {
    var code = String(gameCode || "").trim().toLowerCase();
    if (code === "msbl") {
      return "../assets/nav-buttons/sub/msblball.webp";
    }
    if (code === "msc") {
      return "../assets/nav-buttons/sub/mscball.webp";
    }
    return "../assets/nav-buttons/sub/smsball.webp";
  }

  function hasDisplayText(value) {
    var text = String(value || "").trim();
    return text !== "" && text !== "-";
  }

  function isZeroRecord(value) {
    return /^0\s*-\s*0$/.test(String(value || "").trim());
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

  function buildStatePanel(title, message, actionHtml) {
    return [
      '<section class="profile-state-panel">',
      '<h2 class="profile-state-title">', escapeHtml(title), "</h2>",
      '<p class="profile-state-message">', escapeHtml(message), "</p>",
      actionHtml || "",
      "</section>"
    ].join("");
  }

  function buildLoginAction() {
    return [
      '<p class="profile-state-actions">',
      '<a class="profile-action-button" href="/api/auth/discord/start?returnTo=%2Fprofile">Login with Discord</a>',
      "</p>"
    ].join("");
  }

  function buildCodeSection(title, lines) {
    var rows = Array.isArray(lines)
      ? lines.filter(hasDisplayText)
      : [];
    if (!rows.length) {
      return "";
    }
    return [
      '<section class="profile-panel profile-code-panel">',
      '<h3 class="profile-panel-title">', escapeHtml(title), "</h3>",
      '<div class="profile-code-list">',
      rows.map(function (lineValue) {
        var parts = parseCodeLine(lineValue);
        var prefixHtml = parts.prefix
          ? '<span class="profile-code-prefix">' + escapeHtml(parts.prefix) + "</span>"
          : "";
        return [
          '<div class="profile-code-row">',
          prefixHtml,
          '<span class="profile-code-value">', escapeHtml(parts.code), "</span>",
          "</div>"
        ].join("");
      }).join(""),
      "</div>",
      "</section>"
    ].join("");
  }

  function buildFriendCodes(friendCodes) {
    var data = friendCodes || {};
    var sections = [
      buildCodeSection("Switch Friend Codes", data.switch || []),
      buildCodeSection("MSC Friend Codes (PAL)", data.msc_pal || []),
      buildCodeSection("MSC Friend Codes (NTSC)", data.msc_ntsc || []),
      buildCodeSection("MSC Friend Codes (KOR)", data.msc_kor || []),
      buildCodeSection("MSC Friend Codes (JPN)", data.msc_jpn || [])
    ].filter(Boolean);

    if (!sections.length) {
      return [
        '<section class="profile-panel">',
        '<h3 class="profile-panel-title">Friend Codes</h3>',
        '<p class="profile-muted">No friend codes are listed for this profile.</p>',
        "</section>"
      ].join("");
    }

    return sections.join("");
  }

  function buildRatingLine(label, value, leadingHtml, trailingHtml) {
    return [
      '<p class="profile-rating-line">',
      '<span class="profile-rating-label">', escapeHtml(label), ':</span>',
      leadingHtml || "",
      '<span class="profile-rating-value">', escapeHtml(String(value)), "</span>",
      trailingHtml || "",
      "</p>"
    ].join("");
  }

  function buildRatingCards(cards) {
    return cards.map(function (card) {
      var rating = card && card.rating ? card.rating : {};
      var ratingValue = Number.isFinite(rating.rating) ? rating.rating : null;
      var metricKey = String(card && card.metricKey || "");
      var metricValue = metricKey && Number.isFinite(rating[metricKey]) ? rating[metricKey] : null;
      var setsValue = String(rating.sets || "");
      var gamesValue = String(rating.games || "");
      var cardClass = "profile-rating-card";
      var lines = [];
      var rankIconHtml = rating.rank_icon_url
        ? '<img class="profile-rank-icon" src="' + escapeHtml(rating.rank_icon_url) + '" alt="" aria-hidden="true" loading="lazy">'
        : "";

      if (isZeroRecord(setsValue) || isZeroRecord(gamesValue)) {
        cardClass += " is-inactive-rating";
      }
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
        '<article class="', cardClass, '">',
        '<h4 class="profile-rating-title">', escapeHtml(card.title), "</h4>",
        lines.join(""),
        "</article>"
      ].join("");
    }).filter(Boolean).join("");
  }

  function buildRatings(ratings) {
    var data = ratings || {};
    var singles = buildRatingCards([
      { title: "MSBL", rating: data.msbl || {}, metricKey: "whr", metricLabel: "WHR" },
      { title: "MSC", rating: data.msc || {}, metricKey: "whr", metricLabel: "WHR" },
      { title: "SMS", rating: data.sms || {}, metricKey: "whr", metricLabel: "WHR" }
    ]);
    var doubles = buildRatingCards([
      { title: "MSBL 2v2", rating: data.msbl2v2 || {}, metricKey: "tst", metricLabel: "TST" },
      { title: "MSC 2v2", rating: data.msc2v2 || {}, metricKey: "tst", metricLabel: "TST" },
      { title: "SMS 2v2", rating: data.sms2v2 || {}, metricKey: "tst", metricLabel: "TST" }
    ]);

    if (!singles && !doubles) {
      return "";
    }

    return [
      '<section class="profile-panel profile-ratings-panel">',
      '<h3 class="profile-panel-title">Ratings</h3>',
      singles ? '<div class="profile-ratings-grid">' + singles + "</div>" : "",
      doubles ? '<div class="profile-ratings-grid">' + doubles + "</div>" : "",
      "</section>"
    ].join("");
  }

  function buildAccolades(accolades) {
    var rows = Array.isArray(accolades) ? accolades : [];
    if (!rows.length) {
      return "";
    }

    return [
      '<section class="profile-panel profile-accolades-panel">',
      '<details class="profile-accolades-details">',
      '<summary class="profile-accolades-summary"><span class="profile-panel-title">Recent Tourney Accolades</span></summary>',
      '<ul class="profile-accolades">',
      rows.map(function (entry) {
        var ballIcon = getGameBallIconUrl(entry && entry.game_code);
        var ballIconFallback = String(ballIcon || "").replace(/\.webp$/i, ".png");
        var date = normalizeDateText(entry && entry.start_date);
        return [
          '<li class="profile-accolade-item">',
          '<img class="profile-accolade-ball" src="', escapeHtml(ballIcon), '" alt="" aria-hidden="true" loading="lazy" onerror="this.onerror=null;this.src=\'', escapeHtml(ballIconFallback), '\'">',
          '<span class="profile-accolade-medal">', escapeHtml(entry && entry.place_medal || ""), "</span>",
          '<span class="profile-accolade-name">', escapeHtml(entry && entry.tournament_name || "-"), "</span>",
          date ? '<span class="profile-accolade-date">' + escapeHtml(date) + "</span>" : "",
          "</li>"
        ].join("");
      }).join(""),
      "</ul>",
      "</details>",
      "</section>"
    ].join("");
  }

  function buildProfile(payload) {
    var data = payload && payload.profile ? payload.profile : {};
    var player = data.player || {};
    var countryCode = normalizeCountryCode(player.country);
    var flagHtml = countryCode
      ? '<img class="profile-header-flag" src="' + escapeHtml(getFlagAssetUrl(countryCode)) + '" alt="" aria-hidden="true"' + buildFlagTitleAttr(countryCode) + ' onerror="this.remove();">'
      : "";
    var clubText = String(player.club_name || "").trim()
      ? String(player.club_name || "").trim() + (player.club_tag ? " [" + player.club_tag + "]" : "")
      : "No club membership listed.";
    var resultsUrl = String(player.results_url || "").trim();
    var ratingsHtml = buildRatings(data.ratings || {});
    var resultsHtml = resultsUrl
      ? '<section class="profile-panel profile-results-panel"><h3 class="profile-panel-title">Results</h3><p class="profile-meta-line"><span>Results</span><a href="' + escapeHtml(resultsUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(resultsUrl) + "</a></p></section>"
      : "";

    return [
      '<section class="profile-shell">',
      '<header class="profile-header-panel">',
      '<div class="profile-header-title">',
      '<h2 class="profile-name">', escapeHtml(player.name || "Player Profile"), "</h2>",
      flagHtml,
      "</div>",
      '<div class="profile-meta">',
      '<p class="profile-meta-line"><span>Club</span><strong>', escapeHtml(clubText), "</strong></p>",
      "</div>",
      "</header>",
      '<div class="profile-grid">',
      '<div class="profile-grid-main">',
      buildFriendCodes(data.friend_codes || {}),
      resultsHtml,
      buildAccolades(data.accolades || []),
      "</div>",
      '<div class="profile-grid-side">',
      ratingsHtml,
      "</div>",
      "</div>",
      "</section>"
    ].join("");
  }

  function renderAuthError(mount, payload, status) {
    if (status === 401) {
      mount.innerHTML = buildStatePanel(
        "Login Required",
        "Login with Discord to open your linked player profile.",
        buildLoginAction()
      );
      return;
    }

    if (payload && payload.code === "PLAYER_PROFILE_NOT_LINKED") {
      mount.innerHTML = buildStatePanel(
        "No Linked Player Profile",
        "Your Discord login is valid, but no player profile is linked to this Discord account yet. Contact staff on Discord to link it.",
        '<p class="profile-state-actions"><a class="profile-action-button" href="https://discord.gg/de2YaWg" target="_blank" rel="noopener noreferrer">Open Discord</a></p>'
      );
      return;
    }

    if (payload && payload.code === "PLAYER_PROFILE_CONFLICT") {
      mount.innerHTML = buildStatePanel(
        "Profile Link Conflict",
        "More than one player profile matches this Discord account. Contact staff on Discord so the duplicate link can be fixed.",
        '<p class="profile-state-actions"><a class="profile-action-button" href="https://discord.gg/de2YaWg" target="_blank" rel="noopener noreferrer">Open Discord</a></p>'
      );
      return;
    }

    mount.innerHTML = buildStatePanel(
      "Profile Unavailable",
      "The profile could not be loaded right now. Please try again later.",
      ""
    );
  }

  function removeAuthQuery() {
    if (!window.history || !window.location.search) {
      return;
    }
    var params = new URLSearchParams(window.location.search);
    if (!params.has("auth")) {
      return;
    }
    params.delete("auth");
    var next = window.location.pathname + (params.toString() ? "?" + params.toString() : "") + window.location.hash;
    window.history.replaceState(null, "", next);
  }

  async function loadProfile(mount) {
    mount.innerHTML = '<p class="profile-loading loading-note">Loading...</p>';

    try {
      var response = await fetch("/api/profile/me", {
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });
      var payload = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        renderAuthError(mount, payload, response.status);
        return;
      }
      mount.innerHTML = buildProfile(payload);
      removeAuthQuery();
    } catch (_error) {
      renderAuthError(mount, null, 500);
    }
  }

  function initProfilePage() {
    var page = String(document.body && document.body.getAttribute("data-page") || "").toLowerCase();
    if (page !== "profile") {
      return;
    }
    var mount = document.getElementById("profile-root");
    if (!mount) {
      return;
    }
    loadProfile(mount);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initProfilePage);
    return;
  }

  initProfilePage();
})();
