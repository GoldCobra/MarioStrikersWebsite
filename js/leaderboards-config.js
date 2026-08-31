(function () {
  "use strict";

  var GLOBAL_LEADERBOARD_TABS = [
    { key: "msbl-elo1v1", label: "ELO 1v1", icon: "msblball.png" },
    { key: "msc-elo1v1", label: "ELO 1v1", icon: "mscball.png" },
    { key: "sms-elo1v1", label: "ELO 1v1", icon: "smsball.png" }
  ];

  function createGlobalConfig(pageKey) {
    return {
      gameCode: pageKey,
      title: "Leaderboards",
      tabAriaLabel: "Leaderboard tabs",
      tabs: GLOBAL_LEADERBOARD_TABS
    };
  }

  window.LEADERBOARDS_CONFIG = {
    "competitive-leaderboards": createGlobalConfig("competitive-leaderboards"),
    "msbl-elo1v1": createGlobalConfig("msbl-elo1v1"),
    "msbl-elo2v2": createGlobalConfig("msbl-elo2v2"),
    "msbl-whr": createGlobalConfig("msbl-whr"),
    "msc-elo1v1": createGlobalConfig("msc-elo1v1"),
    "msc-whr": createGlobalConfig("msc-whr"),
    "sms-elo1v1": createGlobalConfig("sms-elo1v1"),
    "sms-whr": createGlobalConfig("sms-whr")
  };
})();
