(function () {
  "use strict";
  var NO_CLUB_LOGO_URL = "../assets/clubs/no-club-logo.png";

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

  function buildStatusHtml(statusText) {
    var text = String(statusText || "").trim();
    if (!text) {
      return "-";
    }

    if (text.toLowerCase() === "invite only") {
      return [
        '<img class="msbl-club-status-icon" src="../assets/clubs/invite-only.png" alt="" aria-hidden="true">',
        '<span class="msbl-club-status-text">', escapeHtml(text), "</span>"
      ].join("");
    }

    return escapeHtml(text);
  }

  function buildMembersHtml(memberCount) {
    return [
      '<img class="msbl-club-members-icon" src="../assets/clubs/members.png" alt="" aria-hidden="true">',
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

  function buildMetaLineHtml(tag, status, memberCount, extras) {
    var statusText = toDisplayStatus(status);

    return [
      '<span class="msbl-club-meta-item msbl-club-tag-meta">', escapeHtml(tag || "-"), "</span>",
      '<span class="msbl-club-meta-item msbl-club-status">', buildStatusHtml(statusText), "</span>",
      '<span class="msbl-club-meta-item msbl-club-extra">', escapeHtml(extras), "</span>",
      '<span class="msbl-club-meta-item msbl-club-members">', buildMembersHtml(memberCount), "</span>"
    ].join("");
  }

  function getLogoUrl(row) {
    var raw = String(row && row.logo || "").trim();
    if (!raw) {
      return "";
    }
    if (!/^https?:\/\//i.test(raw)) {
      return "";
    }
    return raw;
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

  function buildRowsHtml(rows) {
    return rows.map(function (row) {
      var tag = String(row.tag || "").trim();
      var name = String(row.name || "").trim();
      var status = String(row.status || "").trim();
      var memberCount = Number(row.member_count || 0);
      var extras = buildExtrasText(row);

      return [
        '<article class="msbl-club-row" role="listitem">',
        buildLogoHtml(row, name || tag || "Club"),
        '<div class="msbl-club-main">',
        '<div class="msbl-club-primary">',
        '<span class="msbl-club-name">', escapeHtml(name || "-"), "</span>",
        "</div>",
        '<div class="msbl-club-meta">',
        buildMetaLineHtml(tag, status, memberCount, extras),
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
