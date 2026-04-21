(function () {
  "use strict";

  function paragraph(text) {
    return "<p>" + text + "</p>";
  }

  function ul(items) {
    return "<ul class=\"cr-list\">" + items.map(function (item) {
      return "<li>" + item + "</li>";
    }).join("") + "</ul>";
  }

  function ol(items) {
    return "<ol>" + items.map(function (item) {
      return "<li>" + item + "</li>";
    }).join("") + "</ol>";
  }

  function link(label, href) {
    return "<a class=\"cr-link\" href=\"" + href + "\" target=\"_blank\" rel=\"noopener noreferrer\">" + label + "</a>";
  }

  function groupedRestriction(title, points) {
    return [
      paragraph("<strong>" + title + "</strong>"),
      ul(points)
    ].join("");
  }

  var SHARED_CODE_OF_CONDUCT_ITEMS = [
    "Interfering with tournament operation",
    "Acting in an unsportsmanlike or disruptive manner, or annoying, abusing, threatening, or harassing others",
    "Engaging in collusion (for example any agreement to predetermine outcomes)",
    "Cheating by any means",
    "Intentionally delaying or tampering with gameplay",
    "Offensive, vulgar, or obscene gamertags",
    "Sexism, ageism, racism, or any other form of prejudice or bigotry",
    "Engaging in violence or behavior deemed immoral, unethical, disgraceful, or indecent by tournament owners",
    "Offering gifts or rewards to gain competitive advantage or create competitive disadvantage for opponents",
    "Otherwise violating these rules"
  ];

  var SHARED_SCHEDULING_DELAY_ITEMS = [
    "0-10 minutes late: No penalty",
    "10-20 minutes late: Loss of 1 pick (opponent gets first two picks in Game 1 setup)",
    "20-40 minutes late: Forfeit of Game 1",
    "40-60 minutes late: Forfeit of Games 1 and 2",
    "More than 60 minutes late or no-show: Forfeit of the set"
  ];

  var SHARED_SECTIONS = {
    intro: {
      title: "Introduction",
      subsections: [
        {
          title: "Purpose",
          blocks: [
            paragraph("These rules establish a Competition Committee and a standardized competitive ruleset.")
          ]
        },
        {
          title: "Scope and Rule Priority",
          blocks: [
            paragraph("These rules apply by default to Mario Strikers League (MSL) competitions and community-organized tournaments."),
            paragraph("If a tournament publishes explicit event-specific rule changes, those rules apply only to that event."),
            paragraph("Where game-specific rules conflict with universal rules, game-specific rules take precedence."),
            paragraph("For unresolved disputes, Tournament Staff decisions are final for the current event.")
          ]
        }
      ]
    },

    universal: {
      title: "Universal Competitive Rules",
      subsections: [
        {
          title: "Match Administration",
          blocks: [
            paragraph("Before a set starts, players must confirm host setup, match settings, and any organizer requirements."),
            paragraph("If players cannot agree before the set starts, involve Tournament Staff before gameplay. If staff is unavailable, postpone the set until a ruling is possible."),
            paragraph("Once players explicitly agree before match start, the agreement is binding unless a material technical or competitive issue occurs.")
          ]
        },
        {
          title: "Competitive Integrity",
          blocks: [
            paragraph("All games must use organizer-approved settings and versions. Unapproved gameplay-altering methods are prohibited unless explicitly listed as legal in game-specific rules."),
            paragraph("Wired Ethernet is strongly recommended for the most stable competitive match quality and lower latency. It is not mandatory."),
            paragraph("Players should use a connection that avoids avoidable disruptions."),
            paragraph("Players must cooperate with staff requests for evidence, testing, and match-state reconstruction during disputes."),
            paragraph("Players must communicate clearly and act in good faith during setup, gameplay, and dispute resolution.")
          ]
        },
        {
          title: "Dispute Escalation",
          blocks: [
            paragraph("When a dispute occurs (for example stalling or integrity concerns), players must pause at the next legal point and request staff review."),
            paragraph("Provide video evidence whenever possible. If staff is unavailable, record exact details and suspend the set until review."),
            paragraph("Players should not continue play before official review is completed. If they do, retroactive staff action may be limited by available evidence and tournament policy.")
          ]
        }
      ]
    },

    disruptionsCore: {
      title: "Match Disruptions & Technical Issues",
      subsections: [
        {
          title: "Disconnections",
          blocks: [
            paragraph("A disconnect may result in an automatic game loss, but if intent is unclear, match state should be reconstructed as accurately as possible."),
            paragraph("If players cannot agree on reconstruction details, staff should decide the official restart procedure."),
            paragraph("When reconstruction is approved, restore score, key state conditions, and possession as closely as possible."),
            paragraph("If a game-specific disconnection rule exists, that game-specific rule overrides this baseline.")
          ]
        },
        {
          title: "Restarts and Misconfiguration",
          blocks: [
            paragraph("Tournament organizers may approve restarts in exceptional circumstances (for example infrastructure or power interruptions)."),
            paragraph("If settings are misconfigured in a way that could affect the result, request review immediately after that game. Once the next game starts, the prior game is normally locked."),
            paragraph("Repeated misconfiguration may result in escalating penalties.")
          ]
        },
        {
          title: "Stalling Review",
          blocks: [
            paragraph("Stalling or excessive delay may result in game or set forfeiture at organizer discretion."),
            paragraph("If a player believes stalling occurred, formally call it, preserve evidence, and request staff review before continuing."),
            paragraph("Without sufficient evidence, staff action may be limited. If staff is unavailable, suspend the set and resume after review.")
          ]
        },
        {
          title: "Pause Protocol",
          blocks: [
            paragraph("Mid-game pauses are allowed only for urgent technical issues or real-life emergencies, preferably in non-contested states."),
            paragraph("Unauthorized pauses may result in automatic game forfeiture unless both players agree to a resolution or a true emergency is confirmed.")
          ]
        },
        {
          title: "Penalty Ladder",
          blocks: [
            paragraph("Rules violations are subject to penalties including, but not limited to:"),
            ul([
              "Game restart",
              "Loss of a game",
              "Loss of a match",
              "Tournament forfeiture"
            ]),
            paragraph("Any imposed penalty may be made public at organizer discretion.")
          ]
        }
      ]
    },

    scheduling: {
      title: "Scheduling & Matchmaking Conduct",
      subsections: [
        {
          title: "Scheduling Expectations",
          blocks: [
            paragraph("Scheduling with your opponent is part of competitive play. Communicate early and often."),
            ul([
              "Players have real-life responsibilities; respect scheduled set times.",
              "If you cannot make a scheduled time, notify your opponent as early as possible."
            ])
          ]
        },
        {
          title: "Delay and No-Show Penalties",
          blocks: [
            paragraph("When players mutually agree on an official set time, late arrival or no-show without communication triggers these penalties:"),
            ul(SHARED_SCHEDULING_DELAY_ITEMS)
          ]
        },
        {
          title: "Emergency Clause",
          blocks: [
            paragraph("Tournament Staff may rescind penalties and allow rescheduling for valid emergencies that prevented prior communication."),
            paragraph("Abuse of this clause is prohibited. Repeated emergency claims may be denied at staff discretion.")
          ]
        },
        {
          title: "Pressuring",
          blocks: [
            paragraph("Set times must be mutually agreed. Short-notice play is allowed only by mutual agreement."),
            paragraph("Players must not pressure opponents into playing. Staff may penalize pressuring behavior."),
            paragraph("Examples include:"),
            ul([
              "Excessive pinging.",
              "Demanding immediate play by claiming your schedule cannot otherwise meet the deadline."
            ])
          ]
        }
      ]
    },

    codeOfConduct: {
      title: "Code of Conduct",
      subsections: [
        {
          title: "Behavior Standards",
          blocks: [
            paragraph("Players must show good sportsmanship and respect toward opponents and tournament organizers. Players must compete in good faith and avoid behavior inconsistent with honesty and fair play. Inappropriate behavior includes, but is not limited to:"),
            ul(SHARED_CODE_OF_CONDUCT_ITEMS)
          ]
        }
      ]
    }
  };

  var GAME_CONFIGS = {
    sms: {
      pageTitle: "The Super Mario Strikers (Mario Smash Football) Competitive Ruleset",
      revisedText: "Last revised April 17, 2026",
      sourceHref: "https://docs.google.com/document/d/e/2PACX-1vRUeYhYOYrG3jF5yA26U7joUx4uft4yMfqva3mHuw_ZDbTCZaEccZmRTv_bReo1MkPpoSIWst_loqbu/pub",
      sourceLabel: "Published SMS Rules",
      gameSpecific: {
        title: "Game-Specific Rules & Settings",
        subsections: [
          {
            title: "Game Version and Platform",
            blocks: [
              paragraph("Official version: NTSC-U for Nintendo GameCube on the custom Citrus Dolphin build. Required game file format: .iso."),
              paragraph("Download Citrus here: " + link("Citrus Build Download", "https://discord.com/channels/268737069939949569/862655693638205461/1000108888747679834") + "."),
              paragraph("If Citrus does not work, players may use the latest Dolphin Beta as backup: " + link("Dolphin Download", "https://dolphin-emu.org/download/") + ".")
            ]
          },
          {
            title: "Dolphin Netplay Settings",
            blocks: [
              ul([
                "Netplay lobby \"Network\" must be set to \"Fair Input Delay\".",
                "Players should agree on a stable buffer and generally use the lowest value that avoids lag.",
                "A baseline formula is BUFFER = PING / 8, but values may be lower or higher if both players agree.",
                "The absolute minimum buffer is 6, and the absolute maximum buffer is 20.",
                "If no stable connection is possible at buffer 20 or lower, the match should be postponed."
              ])
            ]
          },
          {
            title: "Match Settings and Visual Options",
            blocks: [
              ul([
                "Skill Level: LEGEND",
                "Match Time: 5 MINUTES",
                "Power Ups: ON",
                "Super Strike: OFF",
                "Rumble: ON",
                "Bowser Attack: OFF"
              ]),
              paragraph("Default visual settings:"),
              ul([
                "Camera Type: AUTO ZOOM",
                "Aspect Ratio: WIDE (16:9)"
              ])
            ]
          },
          {
            title: "Stadiums and Match Procedure",
            blocks: [
              paragraph("Any stadium is allowed."),
              paragraph("This process applies to best-of-3, best-of-5, and best-of-7 formats:"),
              ul([
                "In bracket play, higher seed gets first choice. In round robin or Swiss, first choice is decided by coin flip.",
                "The winner of first choice selects one option: stadium, home/away side, or first captain pick.",
                "The other player selects one of the remaining two options, and the last option goes to the first player.",
                "Play the game with the selected stadium and side/captain setup.",
                "After each game, the loser chooses two options from stadium, home/away side, and captain, and the winner gets the remaining option.",
                "The player selecting stadium cannot choose a stadium they already won on earlier in the set unless both players agree.",
                "This restriction applies even when that prior stadium win happened on the opponent's stadium choice.",
                "If setup is incorrect (for example illegal stadium pick), players must quit within the first 5 seconds on the game timer; otherwise the game stands."
              ])
            ]
          },
          {
            title: "Gameplay Restrictions",
            blocks: [
              groupedRestriction("SUPER TEAM", [
                "Super Team is banned due to a run-speed advantage.",
                "Character information: " + link("Character Information", "https://docs.google.com/spreadsheets/d/e/2PACX-1vQH9tbcsCen9qqxYfyHjk-m_XszEXTzB6Yo5_jgEmujpUUsBJl9vxZqITLz7ooblubuhxelAOCx7zRb/pubhtml?gid=0&single=true") + "."
              ]),
              groupedRestriction("CHEAT CODES", [
                "Cheat codes are strictly forbidden, including codes that do not directly affect gameplay."
              ])
            ]
          }
        ]
      },
      disruptionsAdditions: {
        title: "Technical Additions",
        subsections: [
          {
            title: "Restart Reconstruction Details",
            blocks: [
              paragraph("If players cannot agree after a disconnection, restart as close as possible to the original state:"),
              ul([
                "Score: Recreate score differential (for example crash at 7-4 -> recreate as 3-0).",
                "Items: Recreate prior item state, recreate item differential, or agree to restart with no items.",
                "Time and possession: If one player had possession, that player walks the ball into goalie at the correct time and play continues. If possession was contested, walk to goalie and punt with B to resume neutral play."
              ])
            ]
          },
          {
            title: "Multiple Crashes and Lag Disputes",
            blocks: [
              paragraph("For repeated disconnections, reschedule the set after the issue is resolved. Tournament organizers may forfeit a game at their discretion."),
              paragraph("If connection quality is disputed, test in Strikers 101 before the first match and involve staff if no agreement is reached.")
            ]
          },
          {
            title: "Stalling Examples",
            blocks: [
              paragraph("Examples of illegal stalling tactics include:"),
              ul([
                "Standing still in front of your Kritter with the ball.",
                "Dribbling away from the opponent's goal with no defensive pressure and no offensive intent.",
                "Running kickoff possession back to your own defensive corner.",
                "Running back to your Kritter unless one of the following applies: Kritter is stunned/recovering, out of position, you are avoiding an incoming item, or you just collected the ball in your defensive corner."
              ]),
              paragraph("Examples of legal time-wasting plays include:"),
              ul([
                "Holding possession with Kritter as long as possible.",
                "Clearing the ball downfield with a player or Kritter from any location, including kickoff.",
                "Guarding a loose ball by hitting opposing players attempting to challenge."
              ])
            ]
          },
          {
            title: "Pause Timing Details",
            blocks: [
              paragraph("In SMS, if a pause is necessary, wait until your own Kritter has full possession or immediately after a goal."),
              paragraph("Pauses should not exceed 1 minute unless active discussion with Tournament Staff is ongoing. If players cannot agree after 1 minute, contact staff immediately.")
            ]
          }
        ]
      }
    },

    msc: {
      pageTitle: "The MARIO STRIKERS CHARGED (Football) Competitive Ruleset",
      revisedText: "Last revised April 17, 2026",
      sourceHref: "https://docs.google.com/document/d/e/2PACX-1vRQgUz-inFiaOJVnVDWLITqM6g3vm89lI_GstwX7cQl3Pj-Tb8QtAk5mH-HDlPbNnqKyqw4PyZaOxwX/pub",
      sourceLabel: "Published MSC Rules",
      gameSpecific: {
        title: "Game-Specific Rules & Settings",
        subsections: [
          {
            title: "Game Version and Platform",
            blocks: [
              paragraph("Official version: PAL (RQ4P01) on Nintendo Wii or Nintendo Wii U."),
              paragraph("Most current players use PAL. Matchmaking between PAL and NTSC is technically impossible because of region lock."),
              paragraph("Console and Dolphin Emulator are permitted. Players must be able to play via " + link("Wiimmfi", "https://wiimmfi.de/") + ". Netplay is not feasible due to technical limitations."),
              paragraph("As of Dolphin version 2603a or newer, Dolphin natively supports Wiimmfi matchmaking between Dolphin Emulator and console (Wii or Wii U), without additional mods or Cheat Codes."),
              paragraph("Players using emulator must use Dolphin 2603a or newer for official cross-platform play.")
            ]
          },
          {
            title: "Match Settings and Stadium Rules",
            blocks: [
              ul([
                "Skill Level: ANY",
                "Game Type: 10 GOALS",
                "Environment Cheats: SECURE STADIA",
                "Power Up Cheats: NONE",
                "Player Cheats: NONE"
              ]),
              paragraph("Default stadium is BOWSER STADIUM. By mutual agreement, players may choose any stadium except THE SAND TOMB or THUNDER ISLAND."),
              paragraph("Once a player clicks the \"accept\" button of an online invitation, both players agree to the selected stadium for that game. Selecting the wrong stadium is not a valid restart reason unless the stadium is illegal."),
              paragraph("If players are not using the fast terrain Cheat Code, stadium selection is restricted to: BOWSER STADIUM, THE CLASSROOM, THE LAVA PIT, CRYSTAL CANYON.")
            ]
          },
          {
            title: "Match Procedure and Side Selection",
            blocks: [
              paragraph("Match procedure:"),
              ol([
                "Players decide Home and Away for Game 1 using the criteria below. The Away player decides whether to pick captain first or second.",
                "Players play the first game of the set.",
                "The loser of the previous game picks Home or Away for the next game. The Away player decides whether to pick captain first or second.",
                "Play the next game.",
                "Repeat for all subsequent games until the set is complete.",
                "When a set is complete, repeat the same process for the next set, starting from Step 1.",
                "The match ends when a player reaches the required number of set wins. In most cases, one set wins the match, but this may vary by tournament rules."
              ]),
              paragraph("Game 1 side selection priority:"),
              ol([
                "In best-of-X sets, the player who lost the previous set picks side for Game 1 of the next set (not applicable to Set 1).",
                "If a tournament has multiple stages, Stage 1 determines seeding; in later stages, higher seed picks side.",
                "In the MSL World Championship, the player with the most MSL points gets side pick.",
                "If none apply, players flip a coin (for example in " + link("our Discord", "https://discord.gg/de2YaWg") + "), and the winner gets side pick."
              ])
            ]
          },
          {
            title: "Gameplay Restrictions",
            blocks: [
              groupedRestriction(link("NK-BUG", "https://youtu.be/-eOGLyFTQ_k"), [
                "NK-Bug in any form is prohibited due to game-breaking behavior. It results in disqualification from the current tournament and the next seasonal tournament.",
                "If a player unintentionally scores an NK-Bug goal while more than one goal away from victory, that player must score an own goal.",
                "If the accidental NK-Bug goal is the final goal, it does not count and the match must be replayed from the prior score."
              ]),
              groupedRestriction(link("INSTA CHIP / MIDCOURT CHIP", "https://youtu.be/8kwlHBl0Koo"), [
                "Insta Chip or Midcourt Chip after kickoff is prohibited and results in an automatic game loss.",
                "To avoid Insta Chip, the kickoff player must lose contact with the ball at least once before executing a Midcourt Chip.",
                "The following do not count as Midcourt Chip examples: " + link("WALL-LUIGI boosted chips", "https://youtu.be/Crll-G6IXgk?list=PLLAlWhwo9P26CQhRR7yaSblmea687HiWE&t=473") + ", " + link("Shroom Chips", "https://youtu.be/hHvTNRLzpcA?list=PLLAlWhwo9P26CQhRR7yaSblmea687HiWE") + ", and " + link("Bowser Shuttle", "https://youtu.be/WdNDgyVwgzs") + "."
              ]),
              groupedRestriction(link("BOO DEKE GOALS", "https://youtu.be/fbg_jURR2wA"), [
                "Boo deking through the opposing goalkeeper is prohibited and results in an automatic game loss."
              ]),
              groupedRestriction(link("HITSPAM", "https://youtu.be/89qCjtLSNlg"), [
                "Excessive hitspam is prohibited and results in an automatic game loss."
              ]),
              groupedRestriction("MEGA STRIKE", [
                "Mega Strike is prohibited. If used accidentally, any goal from the Mega Strike does not count and the match must be replayed from the score before the Mega Strike."
              ]),
              groupedRestriction("CHEAT CODES", [
                "Cheat codes are strictly forbidden, including any code-based modifications that create unfair advantages or disrupt gameplay (for example lag generators).",
                "Exception (only if both players agree before match start): the Terrain Code that sets all terrains to the default BOWSER STADIUM terrain, and the code that disables Mega Strike. Without pre-match agreement, both codes are prohibited."
              ])
            ]
          }
        ]
      },
      disruptionsAdditions: {
        title: "Technical Additions",
        subsections: [
          {
            title: "Disconnection Reconstruction",
            blocks: [
              paragraph("If a disconnect is unintentional, restart and recreate score until match state matches the point before disconnect."),
              paragraph("Once score is restored, the player who had possession before the disconnect passes the ball to goalie, and gameplay resumes.")
            ]
          },
          {
            title: "Restart and Stalling Notes",
            blocks: [
              paragraph("Tournament organizers may approve a game restart in exceptional circumstances, such as a power outage."),
              paragraph("Stalling or excessive delay may result in game or match forfeiture at organizer discretion.")
            ]
          }
        ]
      }
    },

    msbl: {
      pageTitle: "The Mario Strikers: Battle League (Football) Competitive Ruleset",
      revisedText: "Last revised April 17, 2026",
      sourceHref: "https://docs.google.com/document/d/e/2PACX-1vTs8u7wkcFsjVTv4246QygJMPiVDxzJqruouF_Jjq0C8kxLiG6bzgPBq87m522163_I-YZU4ZTwvtlH/pub",
      sourceLabel: "Published MSBL Rules",
      gameSpecific: {
        title: "Game-Specific Rules & Settings",
        subsections: [
          {
            title: "Match Settings",
            blocks: [
              ul([
                "Match Length: 4:00",
                "Items: COLORED ? BLOCKS ONLY",
                "Hyper Strike: OFF",
                "Gear: ALLOWED"
              ])
            ]
          },
          {
            title: "Match Procedure",
            blocks: [
              ol([
                "The first listed player is host (in 2v2, team captain) and creates the lobby with official settings.",
                "After all players join, the first listed player/team chooses home side, and the second listed player/team chooses away side.",
                "Play the first game.",
                "After Game 1, all players select \"Rematch.\" Players must switch defended sides for the next game.",
                "Play the next game.",
                "Repeat until the match is complete according to the applicable best-of format.",
                "If a game is tied after the 2-minute golden-goal period, play an immediate deciding game where first goal wins."
              ])
            ]
          },
          {
            title: "Gameplay Restrictions",
            blocks: [
              groupedRestriction("EMBROIDER'S CHIP", [
                "Embroider's Chip is banned.",
                "This technique chips off the wall around midfield and shoots shortly after, often forcing Boom Boom out of position and creating non-competitive scoring situations."
              ]),
              groupedRestriction("CHEAT CODES", [
                "Cheat codes are strictly forbidden, including any code-based modifications that alter gameplay."
              ]),
              groupedRestriction("CUSTOM FIRMWARE / EMULATORS", [
                "Playing tournament matches via custom firmware (CFW) or emulators is prohibited and may result in exclusion from Mario Strikers community tournaments."
              ]),
              paragraph("Illegal stalling examples include:"),
              ul([
                "Running the ball back to your keeper, unforced, directly off kickoff.",
                "Standing still in front of your goalie with possession."
              ]),
              paragraph("Legal examples include running back to goalie under pressure and clearing the ball off kickoff.")
            ]
          }
        ]
      },
      disruptionsAdditions: {
        title: "Technical Additions",
        subsections: [
          {
            title: "Disconnection Rule Set",
            blocks: [
              paragraph("If a disconnect occurs within the first 30 seconds, restart the game. If the first disconnect occurs after 30 seconds, start a new game and recreate exact score and time using screenshot or clip evidence."),
              ul([
                "The player who had possession at disconnect regains possession when play resumes.",
                "If possession was neutral, possession is decided by coin flip on resumption.",
                "Neither player may hold items when game resumes.",
                "If a player disconnects a second time in the same match, that player forfeits the current game and all remaining games in that match. The opponent is awarded the game shown by the in-game message \"Your opponent has left the match. The win goes to you!\"."
              ])
            ]
          },
          {
            title: "Lag Investigation Flow",
            blocks: [
              paragraph("If a game is lagging, complete the game first. The result may be invalidated and replayed after review. If a player abandons the game, that player forfeits it."),
              ul([
                "Both players should provide lag evidence clips when possible.",
                "Both players must run a Nintendo Switch connection test and provide screenshots.",
                "Tournament Staff may run additional connection checks to identify likely source.",
                "If no source can be identified, the match must continue to completion. In unresolved cases, Tournament Staff may decide by coin flip."
              ])
            ]
          },
          {
            title: "Additional Penalty Range",
            blocks: [
              paragraph("In addition to baseline penalties, MSBL enforcement may include exclusion from future tournaments."),
              paragraph("If a host repeatedly fails to set correct settings after restart/replay directives, that host forfeits the current game.")
            ]
          }
        ]
      }
    }
  };

  window.COMPETITIVE_RULES_CONFIG = {
    sharedSections: SHARED_SECTIONS,
    gameConfigs: GAME_CONFIGS
  };
})();

