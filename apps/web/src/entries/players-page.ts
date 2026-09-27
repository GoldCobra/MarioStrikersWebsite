// The players page: the player list and the profile popup.

import { bindPlayerProfileTriggers } from "../features/players/player-popup.ts";
import { initPlayersList } from "../features/players/players-list.ts";
import { preloadPageData } from "../lib/api.ts";

preloadPageData();
bindPlayerProfileTriggers();
const mount = document.getElementById("players-root");
if (mount) void initPlayersList(mount);
