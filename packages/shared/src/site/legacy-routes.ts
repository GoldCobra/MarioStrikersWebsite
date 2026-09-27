// Legacy URLs that must keep working. nginx, the local servers and the route checks all read them.

/** Old URL paths that redirect permanently to a page slug (query strings are kept). */
export const LEGACY_REDIRECTS: Readonly<Record<string, string>> = {
  "/pages/msbl": "msbl",
  "/pages/msbl/": "msbl",
  "/pages/msl-league-site.html": "msl-schedule",
  "/pages/msl-league-site": "msl-schedule",
  "/pages/msl-league-site/": "msl-schedule",
  "/msl-league-site": "msl-schedule",
  "/msl-league-site/": "msl-schedule",
};

/** Retired pages answer 404 instead of following the generic /pages/<slug>.html redirect. */
export const RETIRED_PATHS: readonly string[] = [
  "/pages/players-msbl-clubs.html",
  "/pages/msbl-tier-lists.html",
  "/pages/msc-tier-lists.html",
  "/pages/sms-tier-lists.html",
];

/** Old ?submenu= links of the overview pages, mapped to the page they opened. */
export const LEGACY_SUBMENU_ROUTES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  games: {
    msbl: "msbl",
    msc: "msc",
    sms: "sms",
  },
  competitive: {
    rules: "competitive-rules",
    leaderboards: "competitive-leaderboards",
    "tier-lists": "competitive-tier-lists",
    msl: "msl",
    tournaments: "competitive-tournaments",
  },
};
