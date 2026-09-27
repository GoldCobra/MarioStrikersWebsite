// Keys of the datasets every visitor shares; the public data cache refreshes them in the background.

export const PLAYERS_LIST_KEY = "players:list";
export const MSBL_CLUBS_KEY = "clubs:msbl";
export const COMPETITIVE_SEASON_KEY = "competitive-season:current";
/** The cached leaderboards hold the first 100 rows; longer or offset requests read the database. */
export const PUBLIC_LEADERBOARD_LIMIT = 100;

export const PUBLIC_LEADERBOARD_VARIANTS: readonly { readonly game: string; readonly mode: string }[] = Object.freeze([
  { game: "msbl", mode: "elo1v1" },
  { game: "msbl", mode: "elo2v2" },
  { game: "msbl", mode: "whr" },
  { game: "msc", mode: "elo1v1" },
  { game: "msc", mode: "whr" },
  { game: "sms", mode: "elo1v1" },
  { game: "sms", mode: "whr" },
]);

export function leaderboardCacheKey(game: string, mode: string): string {
  return `leaderboard:${game.toLowerCase()}:${mode.toLowerCase()}`;
}

export function isPublicLeaderboardVariant(game: string, mode: string): boolean {
  const key = leaderboardCacheKey(game, mode);
  return PUBLIC_LEADERBOARD_VARIANTS.some((variant) => leaderboardCacheKey(variant.game, variant.mode) === key);
}
