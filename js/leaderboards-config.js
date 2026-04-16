(function () {
  "use strict";

  function createStandardTabs(gameKey) {
    return [
      { key: "elo1v1", label: "ELO 1v1", href: gameKey + "-elo1v1.html" },
      { key: "elo2v2", label: "ELO 2v2", href: gameKey + "-elo2v2.html" },
      { key: "whr", label: "WHR", href: gameKey + "-whr.html" }
    ];
  }

  function createGameConfig(gameKey, title, ariaLabel, defaultTabKey) {
    return {
      gameCode: gameKey,
      title: title,
      tabAriaLabel: ariaLabel,
      defaultTabKey: defaultTabKey,
      tabs: createStandardTabs(gameKey)
    };
  }

  window.LEADERBOARDS_CONFIG = {
    "msbl-elo1v1": createGameConfig("msbl", "MSBL Leaderboards", "MSBL leaderboard modes", "elo1v1"),
    "msbl-elo2v2": createGameConfig("msbl", "MSBL Leaderboards", "MSBL leaderboard modes", "elo2v2"),
    "msbl-whr": createGameConfig("msbl", "MSBL Leaderboards", "MSBL leaderboard modes", "whr"),
    "msc-elo1v1": createGameConfig("msc", "MSC Leaderboards", "MSC leaderboard modes", "elo1v1"),
    "msc-elo2v2": createGameConfig("msc", "MSC Leaderboards", "MSC leaderboard modes", "elo2v2"),
    "msc-whr": createGameConfig("msc", "MSC Leaderboards", "MSC leaderboard modes", "whr"),
    "sms-elo1v1": createGameConfig("sms", "SMS Leaderboards", "SMS leaderboard modes", "elo1v1"),
    "sms-elo2v2": createGameConfig("sms", "SMS Leaderboards", "SMS leaderboard modes", "elo2v2"),
    "sms-whr": createGameConfig("sms", "SMS Leaderboards", "SMS leaderboard modes", "whr")
  };
})();
