(function () {
  "use strict";

  var BERLIN_TIMEZONE = "Europe/Berlin";
  var ANCHOR_ISO = "2026-04-27T10:00:00+02:00";
  var SEASON_DURATION_MS = 4 * 24 * 60 * 60 * 1000;
  var OFFSEASON_DURATION_MS = 3 * 24 * 60 * 60 * 1000;
  var CYCLE_DURATION_MS = SEASON_DURATION_MS + OFFSEASON_DURATION_MS;
  var SECOND_MS = 1000;

  var anchorUtcMs = new Date(ANCHOR_ISO).getTime();
  var countdownNode = document.getElementById("landing-season-countdown");
  var headlineNode = document.querySelector(".landing-club-headline");

  if (!countdownNode) {
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

  function renderCountdownLayout(prefixText, segmentsHtml) {
    countdownNode.innerHTML = "<span class=\"landing-countdown-prefix\">" + prefixText + "</span>"
      + "<span class=\"landing-countdown-group\">" + segmentsHtml + "</span>";
  }

  function renderCountdown() {
    var nowTime = Date.now();
    var cycleState = getCycleState(nowTime);
    var parts = formatCountdownParts(cycleState.remainingMs);
    var prefixText = cycleState.isOffseason ? "SEASON BEGINS:" : "SEASON ENDS IN";

    if (headlineNode) {
      headlineNode.textContent = cycleState.isOffseason
        ? "OFF-SEASON"
        : "THE SEASON IS UNDERWAY!";
    }

    if (parts.totalSeconds < 86400) {
      var totalHours = Math.floor(parts.totalSeconds / 3600);
      var hoursLabel = String(totalHours).padStart(2, "0");
      renderCountdownLayout(
        prefixText,
        joinSegments([
          buildSegment(hoursLabel, "H"),
          buildSegment(parts.m, "M"),
          buildSegment(parts.s, "S")
        ])
      );
      return;
    }

    renderCountdownLayout(
      prefixText,
      joinSegments([
        buildSegment(parts.d, "D"),
        buildSegment(parts.h, "H"),
        buildSegment(parts.m, "M")
      ])
    );
  }

  renderCountdown();
  window.setInterval(renderCountdown, 1000);
})();
