(function () {
  "use strict";

  var GLOBAL_LEADERBOARD_TABS = [
    { key: "msbl-elo1v1", label: "ELO 1v1", href: "msbl-elo1v1.html", icon: "msblball.png" },
    { key: "msbl-elo2v2", label: "ELO 2v2", href: "msbl-elo2v2.html", icon: "msblball.png" },
    { key: "msbl-whr", label: "WHR", href: "msbl-whr.html", icon: "msblball.png" },
    { key: "msc-elo1v1", label: "ELO 1v1", href: "msc-elo1v1.html", icon: "mscball.png" },
    { key: "msc-whr", label: "WHR", href: "msc-whr.html", icon: "mscball.png" },
    { key: "sms-elo1v1", label: "ELO 1v1", href: "sms-elo1v1.html", icon: "smsball.png" },
    { key: "sms-whr", label: "WHR", href: "sms-whr.html", icon: "smsball.png" }
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
    "msbl-elo1v1": createGlobalConfig("msbl-elo1v1"),
    "msbl-elo2v2": createGlobalConfig("msbl-elo2v2"),
    "msbl-whr": createGlobalConfig("msbl-whr"),
    "msc-elo1v1": createGlobalConfig("msc-elo1v1"),
    "msc-whr": createGlobalConfig("msc-whr"),
    "sms-elo1v1": createGlobalConfig("sms-elo1v1"),
    "sms-whr": createGlobalConfig("sms-whr")
  };
})();
