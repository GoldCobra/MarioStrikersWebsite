// Loaded on every page by SiteLayout, before the page's own scripts.

import { initNavigation } from "../features/nav/nav.ts";
import { initTabsGroup, type TabsGroup, type TabsGroupOptions } from "../features/tabs/tabs-engine.ts";

declare global {
  interface Window {
    /** Read by the legacy leaderboards-engine.js until it is a module. */
    GlobalTabsEngine?: { initTabsGroup(options: TabsGroupOptions): TabsGroup | null };
  }
}

window.GlobalTabsEngine = { initTabsGroup };
initNavigation();
