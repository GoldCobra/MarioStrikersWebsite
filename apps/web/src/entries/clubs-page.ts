// The clubs page: the club list and the club popup (src/features/clubs/).

import { initClubsList } from "../features/clubs/clubs-list.ts";

const mount = document.getElementById("msbl-clubs-root");
if (mount) void initClubsList(mount);
