(function () {
  "use strict";

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeCountryCode(countryCode) {
    return window.MSCFlags ? window.MSCFlags.normalizeCountryCode(countryCode) : "";
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

  function stripLegacyFriendCodePrefix(lineValue) {
    return parseCodeLine(lineValue).code;
  }

  function getSwitchFriendCodeLines(data) {
    return (Array.isArray(data.switch) ? data.switch : [])
      .filter(hasDisplayText)
      .map(stripLegacyFriendCodePrefix);
  }

  function prefixLegacyMscLines(lines, regionLabel) {
    return (Array.isArray(lines) ? lines : []).filter(hasDisplayText).map(function (lineValue) {
      return regionLabel + ": " + stripLegacyFriendCodePrefix(lineValue);
    });
  }

  function getMscFriendCodeLines(data) {
    if (Array.isArray(data.msc) && data.msc.some(hasDisplayText)) {
      return data.msc;
    }

    return []
      .concat(prefixLegacyMscLines(data.msc_pal, "PAL"))
      .concat(prefixLegacyMscLines(data.msc_ntsc, "NTSC-U"))
      .concat(prefixLegacyMscLines(data.msc_jpn, "NTSC-J"))
      .concat(prefixLegacyMscLines(data.msc_kor, "NTSC-K"));
  }

  function buildFriendCodes(friendCodes) {
    var data = friendCodes || {};
    var sections = [
      buildCodeSection("Switch Friend Code", getSwitchFriendCodeLines(data)),
      buildCodeSection("MSC Friend Codes", getMscFriendCodeLines(data))
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

  function buildRatings(ratings) {
    var ratingCards = window.MSCRatingCards;
    if (!ratingCards) {
      return "";
    }
    var data = ratings || {};
    var singles = ratingCards.buildSingles(data, "profile");
    var doubles = ratingCards.buildDoubles(data, "profile");

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

  function buildSeasonAwards(awards) {
    var rows = Array.isArray(awards) ? awards : [];
    if (!rows.length) {
      return "";
    }

    return [
      '<section class="profile-panel profile-season-awards-panel">',
      '<details class="profile-season-awards-details">',
      '<summary class="profile-season-awards-summary"><span class="profile-panel-title">Season Rewards</span></summary>',
      '<ul class="profile-season-awards">',
      rows.map(function (entry) {
        var ballIcon = getGameBallIconUrl(entry && entry.game_code);
        var ballIconFallback = String(ballIcon || "").replace(/\.webp$/i, ".png");
        return [
          '<li class="profile-season-award-item">',
          '<span class="profile-season-award-season">', escapeHtml(entry && entry.season_name || ""), "</span>",
          '<img class="profile-season-award-ball" src="', escapeHtml(ballIcon), '" alt="" aria-hidden="true" loading="lazy" onerror="this.onerror=null;this.src=\'', escapeHtml(ballIconFallback), '\'">',
          '<span class="profile-season-award-name">', escapeHtml(entry && entry.award_name || "-"), "</span>",
          "</li>"
        ].join("");
      }).join(""),
      "</ul>",
      "</details>",
      "</section>"
    ].join("");
  }

  // A world champion title keeps its gold glow; every other tournament win is tinted in that
  // game's colour instead. Anything below first place stays plain.
  var ACCOLADE_WINNER_GAMES = ["msbl", "msc", "sms"];

  function buildAccoladeNameClasses(baseClass, entry) {
    if (entry && entry.is_world_champion) {
      return baseClass + " is-world-champion";
    }
    var game = String(entry && entry.game_code || "").toLowerCase();
    if (entry && entry.is_winner && ACCOLADE_WINNER_GAMES.indexOf(game) !== -1) {
      return baseClass + " is-winner-" + game;
    }
    return baseClass;
  }

  function buildAccolades(accolades) {
    var rows = Array.isArray(accolades) ? accolades : [];
    if (!rows.length) {
      return "";
    }

    return [
      '<section class="profile-panel profile-accolades-panel">',
      '<details class="profile-accolades-details">',
      '<summary class="profile-accolades-summary"><span class="profile-panel-title">Tourney Accolades</span></summary>',
      '<ul class="profile-accolades">',
      rows.map(function (entry) {
        var ballIcon = getGameBallIconUrl(entry && entry.game_code);
        var ballIconFallback = String(ballIcon || "").replace(/\.webp$/i, ".png");
        var date = normalizeDateText(entry && entry.start_date);
        return [
          '<li class="profile-accolade-item">',
          '<img class="profile-accolade-ball" src="', escapeHtml(ballIcon), '" alt="" aria-hidden="true" loading="lazy" onerror="this.onerror=null;this.src=\'', escapeHtml(ballIconFallback), '\'">',
          '<span class="profile-accolade-medal', (entry && entry.is_world_champion ? " is-world-champion" : ""), '">', escapeHtml(entry && entry.place_medal || ""), "</span>",
          '<span class="', escapeHtml(buildAccoladeNameClasses("profile-accolade-name", entry)), '">', escapeHtml(entry && entry.tournament_name || "-"), "</span>",
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
      ? '<section class="profile-panel profile-results-panel"><p class="profile-meta-line profile-results-line"><a href="' + escapeHtml(resultsUrl) + '" target="_blank" rel="noopener noreferrer">Results at start.gg</a></p></section>'
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
      buildSeasonAwards(data.season_awards || []),
      buildAccolades(data.accolades || []),
      resultsHtml,
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
