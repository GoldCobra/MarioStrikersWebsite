// The MSC Wiimmfi page: players online now.

import { initWiimmfi } from "../features/wiimmfi/wiimmfi.ts";

const results = document.getElementById("wiimmfi-results");
if (results) initWiimmfi(results);
