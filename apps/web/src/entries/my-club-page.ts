// The signed-in member's club (docs/adr/0012).

import { initMyClubPage } from "../features/my-club/my-club-page.ts";

const mount = document.getElementById("my-club-root");
if (mount) void initMyClubPage(mount);
