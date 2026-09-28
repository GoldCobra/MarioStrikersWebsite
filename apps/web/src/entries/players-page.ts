// The players page: the player list and the profile popup.

import { bindPlayerProfileTriggers } from "../features/players/player-popup.ts";
import { initPlayersList } from "../features/players/players-list.ts";

bindPlayerProfileTriggers();
const mount = document.getElementById("players-root");
if (mount) void initPlayersList(mount);
