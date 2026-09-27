// Shared constants for every comparison spec. The page list mirrors the public site;
// once the route registry exists it replaces this list.

export const FIXTURE_NOW = "2026-10-15T12:00:00.000Z";

export const PAGE_WIDTHS = [320, 390, 768, 1024, 1280, 1440] as const;
export const STATE_WIDTHS = [390, 1024, 1440] as const;
export const DOM_WIDTH = 1280;

export const PAGE_SLUGS = [
  "index",
  "about-us",
  "community-tournaments",
  "competitive",
  "competitive-leaderboards",
  "competitive-rules",
  "competitive-tier-lists",
  "competitive-tournaments",
  "games",
  "msbl",
  "msbl-competitiverules",
  "msbl-elo1v1",
  "msbl-elo2v2",
  "msbl-gear-builder",
  "msbl-save-editor",
  "msbl-striker-clubs",
  "msbl-tierlist",
  "msbl-whr",
  "msc",
  "msc-competitiverules",
  "msc-elo1v1",
  "msc-save-editor",
  "msc-setup-guide",
  "msc-tierlist",
  "msc-whr",
  "msc-wiimmfi",
  "msl",
  "msl-leaderboards",
  "msl-league-rules",
  "msl-schedule",
  "partners",
  "players",
  "players-profiles",
  "privacy-policy",
  "profile",
  "sms",
  "sms-competitiverules",
  "sms-elo1v1",
  "sms-setup-guide",
  "sms-tierlist",
  "sms-whr",
  "tab-placeholder"
] as const;

export function pagePath(slug: string): string {
  return slug === "index" ? "/" : "/" + slug;
}

export const LEADERBOARD_GAMES = ["msbl", "msc", "sms"] as const;
export const LEADERBOARD_MODES = ["elo1v1", "elo2v2", "whr"] as const;
export const FIXTURE_PLAYER_COUNT = 48;
export const FIXTURE_CLUB_COUNT = 12;
