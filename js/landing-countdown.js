(function () {
  "use strict";

  var END_DATE_ISO = "2026-04-20T10:00:00+02:00";
  var countdownNode = document.getElementById("landing-season-countdown");

  if (!countdownNode) {
    return;
  }

  function formatCountdownParts(totalMs) {
    var safeMs = totalMs > 0 ? totalMs : 0;
    var totalMinutes = Math.floor(safeMs / 60000);
    var days = Math.floor(totalMinutes / 1440);
    var hours = Math.floor((totalMinutes % 1440) / 60);
    var minutes = totalMinutes % 60;

    return {
      d: String(days).padStart(2, "0"),
      h: String(hours).padStart(2, "0"),
      m: String(minutes).padStart(2, "0")
    };
  }

  function renderCountdown() {
    var endTime = new Date(END_DATE_ISO).getTime();
    var nowTime = Date.now();
    var remainingMs = endTime - nowTime;
    var parts = formatCountdownParts(remainingMs);

    countdownNode.innerHTML = "SEASON ENDS: "
      + parts.d + "<span class=\"landing-countdown-unit\">D</span> "
      + parts.h + "<span class=\"landing-countdown-unit\">H</span> "
      + parts.m + "<span class=\"landing-countdown-unit\">M</span>";
  }

  renderCountdown();
  window.setInterval(renderCountdown, 1000);
})();
