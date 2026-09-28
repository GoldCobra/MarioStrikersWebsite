// Leaderboard pages: the rows of the active tab and the player popup on names.

import { initLeaderboard } from "../features/leaderboards/leaderboard.ts";
import { bindPlayerProfileTriggers } from "../features/players/player-popup.ts";
import { preloadPageData } from "../lib/api.ts";

preloadPageData();
bindPlayerProfileTriggers();
initLeaderboard();
