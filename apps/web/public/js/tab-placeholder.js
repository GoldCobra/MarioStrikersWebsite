(function () {
  "use strict";

  var stateNode = document.getElementById("tab-placeholder-status");
  var switchNodes = Array.prototype.slice.call(document.querySelectorAll(".tab-placeholder-switch"));
  var params = new URLSearchParams(window.location.search || "");

  if (!stateNode || switchNodes.length === 0) {
    return;
  }

  var STATES = {
    review: "UNDER REVIEW...",
    construction: "UNDER CONSTRUCTION...",
    tba: "TBA..."
  };

  function normalizeState(rawState) {
    var key = String(rawState || "").trim().toLowerCase();
    if (key === "under-review" || key === "under_review") {
      return "review";
    }
    if (key === "under-construction" || key === "under_construction") {
      return "construction";
    }
    if (key === "tba") {
      return "tba";
    }
    return key;
  }

  function applyState(stateKey) {
    var normalized = normalizeState(stateKey);
    var finalState = STATES[normalized] ? normalized : "review";
    stateNode.textContent = STATES[finalState];

    switchNodes.forEach(function (node) {
      var isActive = node.getAttribute("data-state") === finalState;
      node.classList.toggle("is-active", isActive);
      if (isActive) {
        node.setAttribute("aria-current", "page");
      } else {
        node.removeAttribute("aria-current");
      }
    });
  }

  function bindSwitches() {
    switchNodes.forEach(function (node) {
      node.addEventListener("click", function (event) {
        event.preventDefault();
        var nextState = node.getAttribute("data-state") || "review";
        params.set("state", nextState);
        var nextUrl = window.location.pathname + "?" + params.toString();
        window.history.replaceState(null, "", nextUrl);
        applyState(nextState);
      });
    });
  }

  bindSwitches();
  applyState(params.get("state"));
})();
