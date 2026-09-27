// The clubs page; the list and its popup are still legacy msbl-clubs-engine.js, which reads these
// helpers from window.

import { preloadPageData } from "../lib/api.ts";
import { exposeCountries, exposePublicData } from "../lib/legacy-globals.ts";

exposePublicData();
exposeCountries();
preloadPageData();
