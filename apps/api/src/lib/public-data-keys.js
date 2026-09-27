const PLAYERS_LIST_KEY = "players:list";
const MSBL_CLUBS_KEY = "clubs:msbl";
const COMPETITIVE_SEASON_KEY = "competitive-season:current";
const PUBLIC_LEADERBOARD_LIMIT = 100;
const PUBLIC_LEADERBOARD_VARIANTS = Object.freeze([
  { game: "msbl", mode: "elo1v1" }, { game: "msbl", mode: "elo2v2" },
  { game: "msbl", mode: "whr" }, { game: "msc", mode: "elo1v1" },
  { game: "msc", mode: "whr" }, { game: "sms", mode: "elo1v1" },
  { game: "sms", mode: "whr" }
]);
function leaderboardCacheKey(game, mode) {
  return "leaderboard:" + String(game || "").toLowerCase() + ":" + String(mode || "").toLowerCase();
}
function isPublicLeaderboardVariant(game, mode) {
  const key = leaderboardCacheKey(game, mode);
  return PUBLIC_LEADERBOARD_VARIANTS.some(function (variant) {
    return leaderboardCacheKey(variant.game, variant.mode) === key;
  });
}
module.exports = { PLAYERS_LIST_KEY, MSBL_CLUBS_KEY, COMPETITIVE_SEASON_KEY, PUBLIC_LEADERBOARD_LIMIT, PUBLIC_LEADERBOARD_VARIANTS, leaderboardCacheKey, isPublicLeaderboardVariant };
