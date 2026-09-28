(function () {
  "use strict";

  var REGION_LABELS = {
    R4QP: "PAL",
    R4QE: "NTSC-U",
    R4QJ: "NTSC-J",
    R4QK: "NTSC-K"
  };

  var resultsEl = null;
  var countdownTimer = null;
  var secondsUntilRefresh = 60;

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTime(date) {
    var h = String(date.getHours()).padStart(2, "0");
    var m = String(date.getMinutes()).padStart(2, "0");
    var s = String(date.getSeconds()).padStart(2, "0");
    return h + ":" + m + ":" + s;
  }

  function renderPlayers(players) {
    if (!resultsEl) return;

    if (!players || players.length === 0) {
      resultsEl.innerHTML = '<p class="online-editor-empty">No players online.</p>';
      return;
    }

    var rows = [];
    for (var i = 0; i < players.length; i++) {
      var player = players[i];
      var regionLabel = REGION_LABELS[player.region] || escapeHtml(player.region) || "–";

      rows.push(
        '<tr class="online-editor-separator-row" aria-hidden="true">' +
        '<td colspan="3"><span class="online-editor-row-separator"></span></td>' +
        "</tr>"
      );
      rows.push(
        "<tr>" +
        '<td><span class="online-editor-roster-name">' + escapeHtml(player.name) + "</span></td>" +
        '<td><span class="online-editor-roster-code">' + escapeHtml(player.friendCode) + "</span></td>" +
        '<td><span class="wiimmfi-region">' + escapeHtml(regionLabel) + "</span></td>" +
        "</tr>"
      );
    }

    var html =
      '<table class="online-editor-table">' +
      "<thead><tr>" +
      "<th><span class=\"online-editor-roster-name\">" +
      "<span class=\"online-editor-roster-header-muted\">Online Now </span>" +
      "<span class=\"online-editor-roster-count\">" + players.length + "</span>" +
      "</span></th>" +
      "<th><span class=\"online-editor-roster-code online-editor-roster-header-muted\">Friend Code</span></th>" +
      "<th><span class=\"wiimmfi-region-head online-editor-roster-header-muted\">Region</span></th>" +
      "</tr></thead>" +
      "<tbody>" + rows.join("") + "</tbody>" +
      "</table>" +
      '<p class="wiimmfi-last-updated" id="wiimmfi-last-updated">Updated: ' + escapeHtml(formatTime(new Date())) + "</p>";

    resultsEl.innerHTML = html;
  }

  function renderError() {
    if (!resultsEl) return;
    resultsEl.innerHTML = '<p class="online-editor-empty">Could not load data.</p>';
  }

  function startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    secondsUntilRefresh = 60;
    countdownTimer = setInterval(function () {
      secondsUntilRefresh -= 1;
      var el = document.getElementById("wiimmfi-last-updated");
      if (el) {
        var base = el.getAttribute("data-base-text") || el.textContent.split(" – ")[0];
        el.setAttribute("data-base-text", base);
        el.textContent = base + " – next update in " + secondsUntilRefresh + "s";
      }
      if (secondsUntilRefresh <= 0) {
        clearInterval(countdownTimer);
      }
    }, 1000);
  }

  function getApiBase() {
    return window.APP_RUNTIME_CONFIG && window.APP_RUNTIME_CONFIG.apiBase
      ? String(window.APP_RUNTIME_CONFIG.apiBase)
      : "";
  }

  function loadAndRender() {
    fetch(getApiBase() + "/api/wiimmfi/msc-charged", { headers: { Accept: "application/json" } })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        renderPlayers(data && Array.isArray(data.players) ? data.players : []);
        startCountdown();
      })
      .catch(function () {
        renderError();
      });
  }

  function init() {
    resultsEl = document.getElementById("wiimmfi-results");
    if (!resultsEl) return;

    loadAndRender();
    setInterval(loadAndRender, 60000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
