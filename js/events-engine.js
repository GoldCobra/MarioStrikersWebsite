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
      '<section class="events-list" aria-label="Current events">',
      rows.map(function (row) {
        var name = String(row && row.name || "").trim() || "Event";
        var url = String(row && row.url || "").trim();
        if (!url) {
          return "";
        }
        return [
          '<article class="events-card">',
          '<a class="events-card-link" href="', escapeHtml(url), '" target="_blank" rel="noopener noreferrer">',
          '<span class="events-card-hash" aria-hidden="true">#</span>',
          '<span class="events-card-name">', escapeHtml(name), '</span>',
          '</a>',
          '</article>'
        ].join("");
      }).join(""),
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
