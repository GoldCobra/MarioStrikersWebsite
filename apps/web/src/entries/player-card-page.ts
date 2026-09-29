// The compact player card (/player-card?player=<id>) that the Discord bot screenshots for /profile show.

import { showPlayerCard } from "../features/players/player-popup.ts";

void showPlayerCard(Number(new URLSearchParams(window.location.search).get("player")));
