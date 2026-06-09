(function () {
  "use strict";

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fetchJson(url) {
    return fetch(url, {
      headers: { Accept: "application/json" }
    }).then(function (response) {
      if (!response.ok) {
        throw new Error("Events request failed.");
      }
      return response.json();
    });
  }

  function renderLoading(mount) {
    mount.innerHTML = '<p class="events-note loading-note">Loading...</p>';
  }

  function renderEmpty(mount) {
    mount.innerHTML = '<p class="events-note">No events are currently listed.</p>';
  }

  function renderError(mount) {
    mount.innerHTML = '<p class="events-note events-note-error">Events could not be loaded.</p>';
  }

  function renderRows(mount, rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      renderEmpty(mount);
      return;
    }

    mount.innerHTML = [
      '<section class="leaderboard-block players-list-block events-list-block">',
      '<section class="leaderboard-list players-list events-list" role="list" aria-label="Current tournaments">',
      rows.map(function (row) {
        var name = String(row && (row.display_name || row.name) || "").trim() || "EVENT";
        var url = String(row && row.url || "").trim();
        var imageUrl = String(row && row.image_url || "").trim();
        var iconHtml = imageUrl
          ? '<img class="players-flag events-game-ball" src="' + escapeHtml(imageUrl) + '" alt="" aria-hidden="true" loading="lazy" onerror="this.onerror=null;this.remove();">'
          : "";
        if (!url) {
          return "";
        }
        return [
          '<article class="lb-row players-row events-row" role="listitem">',
          '<a class="events-row-link" href="', escapeHtml(url), '" target="_blank" rel="noopener noreferrer" aria-label="Open Discord channel for ', escapeHtml(name), '">',
          '<div class="lb-inner-frame players-inner-frame events-inner-frame">',
          '<div class="lb-rank-cell players-flag-cell events-channel-cell" aria-hidden="true">',
          '<span class="players-flag-slot events-channel-icon">', iconHtml, '</span>',
          '</div>',
          '<span class="lb-player players-name events-name">',
          '<span class="players-name-text events-name-text">', escapeHtml(name), '</span>',
          '</span>',
          '<div class="lb-points players-points-spacer events-points-spacer" aria-hidden="true"></div>',
          '</div>',
          '</a>',
          '</article>'
        ].join("");
      }).join(""),
      '</section>',
      '</section>'
    ].join("");
  }

  async function initEventsPage() {
    var page = String(document.body && document.body.getAttribute("data-page") || "").toLowerCase();
    if (page !== "community-tournaments") {
      return;
    }

    var mount = document.getElementById("events-root");
    if (!mount) {
      return;
    }

    renderLoading(mount);
    try {
      var payload = await fetchJson("/api/events/community");
      renderRows(mount, payload && payload.rows);
    } catch (_error) {
      renderError(mount);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initEventsPage);
    return;
  }

  initEventsPage();
})();
