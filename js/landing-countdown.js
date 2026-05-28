(function () {
  "use strict";

  var BERLIN_TIMEZONE = "Europe/Berlin";
  var ANCHOR_ISO = "2026-04-27T10:00:00+02:00";
  var SEASON_DURATION_MS = 4 * 24 * 60 * 60 * 1000;
  var OFFSEASON_DURATION_MS = 3 * 24 * 60 * 60 * 1000;
  var CYCLE_DURATION_MS = SEASON_DURATION_MS + OFFSEASON_DURATION_MS;
  var SECOND_MS = 1000;
  var COMPETITIVE_SEASON_API_PATH = "/api/competitive-season/current";

  var anchorUtcMs = new Date(ANCHOR_ISO).getTime();
  var localCountdownNodes = Array.prototype.slice.call(document.querySelectorAll("[data-local-season-countdown]"));
  var competitiveCountdownNodes = Array.prototype.slice.call(document.querySelectorAll("[data-competitive-season-countdown]"));
  var competitiveSeasonState = {
    payload: null,
    serverOffsetMs: 0,
    requestInFlight: false,
    refreshAfterTarget: false
  };

  if (!localCountdownNodes.length && !competitiveCountdownNodes.length) {
    return;
  }

  function getPartMap(parts) {
    return parts.reduce(function (acc, part) {
      if (part.type !== "literal") {
        acc[part.type] = part.value;
      }
      return acc;
    }, {});
  }

  function getTimezoneOffsetMsAt(timeMs, timezone) {
    var safeTimeMs = Math.floor(timeMs / SECOND_MS) * SECOND_MS;
    var formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
    var partMap = getPartMap(formatter.formatToParts(new Date(safeTimeMs)));
    var wallClockUtcMs = Date.UTC(
      Number(partMap.year),
      Number(partMap.month) - 1,
      Number(partMap.day),
      Number(partMap.hour),
      Number(partMap.minute),
      Number(partMap.second)
    );
    return wallClockUtcMs - safeTimeMs;
  }

  function toPositiveModulo(value, base) {
    return ((value % base) + base) % base;
  }

  function getCycleState(nowUtcMs) {
    var offsetNowMs = getTimezoneOffsetMsAt(nowUtcMs, BERLIN_TIMEZONE);
    var offsetAnchorMs = getTimezoneOffsetMsAt(anchorUtcMs, BERLIN_TIMEZONE);
    var elapsedLocalMs = (nowUtcMs + offsetNowMs) - (anchorUtcMs + offsetAnchorMs);
    var cyclePositionMs = toPositiveModulo(elapsedLocalMs, CYCLE_DURATION_MS);
    var isOffseason = cyclePositionMs < OFFSEASON_DURATION_MS;

    if (isOffseason) {
      return {
        isOffseason: true,
        remainingMs: OFFSEASON_DURATION_MS - cyclePositionMs
      };
    }

    return {
      isOffseason: false,
      remainingMs: SEASON_DURATION_MS - (cyclePositionMs - OFFSEASON_DURATION_MS)
    };
  }

  function parseTimeMs(value) {
    var time = new Date(value || "").getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function formatCountdownParts(totalMs) {
    var safeMs = totalMs > 0 ? totalMs : 0;
    var totalSeconds = Math.floor(safeMs / 1000);
    var days = Math.floor(totalSeconds / 86400);
    var hours = Math.floor((totalSeconds % 86400) / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;

    return {
      totalSeconds: totalSeconds,
      d: String(days).padStart(2, "0"),
      h: String(hours).padStart(2, "0"),
      m: String(minutes).padStart(2, "0"),
      s: String(seconds).padStart(2, "0")
    };
  }

  function buildSegment(value, unit) {
    var safeValue = String(value).padStart(2, "0");
    var d1 = safeValue.charAt(0);
    var d2 = safeValue.charAt(1);
    return "<span class=\"landing-countdown-segment\">"
      + "<span class=\"landing-countdown-char\">" + d1 + "</span>"
      + "<span class=\"landing-countdown-char\">" + d2 + "</span>"
      + "<span class=\"landing-countdown-char landing-countdown-char-unit\">" + unit + "</span>"
      + "</span>";
  }

  function joinSegments(segments) {
    return segments.join("");
  }

  function buildSegmentsForRemaining(totalMs) {
    var parts = formatCountdownParts(totalMs);

    if (parts.totalSeconds < 86400) {
      var totalHours = Math.floor(parts.totalSeconds / 3600);
      var hoursLabel = String(totalHours).padStart(2, "0");
      return joinSegments([
        buildSegment(hoursLabel, "H"),
        buildSegment(parts.m, "M"),
        buildSegment(parts.s, "S")
      ]);
    }

    return joinSegments([
      buildSegment(parts.d, "D"),
      buildSegment(parts.h, "H"),
      buildSegment(parts.m, "M")
    ]);
  }

  function renderCountdownLayout(countdownNode, prefixText, segmentsHtml) {
    countdownNode.innerHTML = "<span class=\"landing-countdown-prefix\">" + prefixText + "</span>"
      + "<span class=\"landing-countdown-group\">" + segmentsHtml + "</span>";
  }

  function updateCountdownNode(countdownNode, headlineText, prefixText, segmentsHtml) {
    var clubNode = countdownNode.closest(".landing-club");
    var headlineNode = clubNode ? clubNode.querySelector(".landing-club-headline") : null;

    if (headlineNode) {
      headlineNode.textContent = headlineText;
    }

    renderCountdownLayout(countdownNode, prefixText, segmentsHtml);
  }

  function getCountdownNowMs() {
    return Date.now() - competitiveSeasonState.serverOffsetMs;
  }

  function renderLocalCountdown(nowUtcMs) {
    if (!localCountdownNodes.length) {
      return;
    }

    var cycleState = getCycleState(nowUtcMs);
    var prefixText = cycleState.isOffseason ? "SEASON BEGINS:" : "SEASON ENDS IN";
    var headlineText = cycleState.isOffseason
      ? "OFF-SEASON"
      : "THE SEASON IS UNDERWAY!";
    var segmentsHtml = buildSegmentsForRemaining(cycleState.remainingMs);

    localCountdownNodes.forEach(function (countdownNode) {
      updateCountdownNode(countdownNode, headlineText, prefixText, segmentsHtml);
    });
  }

  function getApiBase() {
    var runtime = window.APP_RUNTIME_CONFIG || {};
    return String(runtime.leaderboardsApiBase || "").trim().replace(/\/+$/, "");
  }

  function getCompetitiveSeasonPhase(season, nowUtcMs) {
    var startMs = parseTimeMs(season && season.startDateUtc);
    var endMs = parseTimeMs(season && season.endDateUtc);
    var headlineText = String(season && season.displayName ? season.displayName : "COMPETITIVE SEASON").trim();

    if (startMs && nowUtcMs < startMs) {
      return {
        headlineText: headlineText,
        prefixText: "SEASON BEGINS:",
        remainingMs: startMs - nowUtcMs,
        targetMs: startMs
      };
    }

    if (endMs && nowUtcMs < endMs) {
      return {
        headlineText: headlineText,
        prefixText: "SEASON ENDS IN",
        remainingMs: endMs - nowUtcMs,
        targetMs: endMs
      };
    }

    return {
      headlineText: headlineText,
      prefixText: "SEASON ENDED:",
      remainingMs: 0,
      targetMs: endMs || startMs || 0
    };
  }

  function renderCompetitiveSeasonCountdown(nowUtcMs) {
    if (!competitiveCountdownNodes.length || !competitiveSeasonState.payload) {
      return;
    }

    var season = competitiveSeasonState.payload.season;
    if (!season) {
      return;
    }

    var phase = getCompetitiveSeasonPhase(season, nowUtcMs);
    var segmentsHtml = buildSegmentsForRemaining(phase.remainingMs);

    competitiveCountdownNodes.forEach(function (countdownNode) {
      updateCountdownNode(countdownNode, phase.headlineText, phase.prefixText, segmentsHtml);
    });

    if (phase.targetMs && phase.remainingMs <= 0 && !competitiveSeasonState.refreshAfterTarget) {
      competitiveSeasonState.refreshAfterTarget = true;
      window.setTimeout(fetchCompetitiveSeasonStatus, 5000);
    }
  }

  function renderAllCountdowns() {
    var nowUtcMs = getCountdownNowMs();
    renderLocalCountdown(nowUtcMs);
    renderCompetitiveSeasonCountdown(nowUtcMs);
  }

  async function fetchCompetitiveSeasonStatus() {
    if (!competitiveCountdownNodes.length || competitiveSeasonState.requestInFlight) {
      return;
    }

    competitiveSeasonState.requestInFlight = true;
    try {
      var response = await fetch(getApiBase() + COMPETITIVE_SEASON_API_PATH, {
        headers: { Accept: "application/json" },
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error("Competitive season API failed with " + response.status);
      }

      var payload = await response.json();
      var serverNowMs = parseTimeMs(payload && payload.serverNowUtc);
      competitiveSeasonState.payload = payload;
      competitiveSeasonState.serverOffsetMs = serverNowMs ? Date.now() - serverNowMs : 0;
      competitiveSeasonState.refreshAfterTarget = false;
      renderAllCountdowns();
    } catch (error) {
      if (window.console && typeof window.console.warn === "function") {
        window.console.warn("[landing-countdown] Competitive season status failed:", error);
      }
    } finally {
      competitiveSeasonState.requestInFlight = false;
    }
  }

  renderAllCountdowns();
  fetchCompetitiveSeasonStatus();
  window.setInterval(renderAllCountdowns, 1000);
  window.setInterval(fetchCompetitiveSeasonStatus, 60000);
})();
