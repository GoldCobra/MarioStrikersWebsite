// Loaded on every page by SiteLayout, before the page's own scripts.

import { initNavigation } from "../features/nav/nav.ts";
import { installImageFallbacks } from "../lib/image-fallbacks.ts";

installImageFallbacks();
initNavigation();
