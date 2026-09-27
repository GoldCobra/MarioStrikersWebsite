// Loaded on every page by SiteLayout, before the page's own scripts.

import { initNavigation } from "../features/nav/nav.ts";
import { exposeTabsEngine } from "../lib/legacy-globals.ts";

exposeTabsEngine();
initNavigation();
