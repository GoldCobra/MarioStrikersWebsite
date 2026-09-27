// The signed-in player's own profile.

import { initProfilePage } from "../features/profile/profile-page.ts";

const mount = document.getElementById("profile-root");
if (mount) void initProfilePage(mount);
