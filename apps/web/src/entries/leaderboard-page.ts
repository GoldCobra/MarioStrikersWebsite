// Leaderboard pages: the player popup on names; the leaderboard itself is still legacy
// leaderboards-engine.js, which reads the shared fetch from window.

import { bindPlayerProfileTriggers } from "../features/players/player-popup.ts";
import { preloadPageData } from "../lib/api.ts";
import { exposePublicData } from "../lib/legacy-globals.ts";

exposePublicData();
preloadPageData();
bindPlayerProfileTriggers();
