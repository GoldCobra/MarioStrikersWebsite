// Competitive rank icons and season reward levels, shared by the API and the rating cards.

/** Cache tag of the rank and reward icons; bump it when an icon file changes content. */
export const RANK_ICON_ASSET_VERSION = "20260608-rank-crop-v1";

export const COMPETITIVE_RANK_ICON_BASE_URL = "/assets/leaderboards/rankicons/";
export const SEASON_REWARD_LEVEL_BASE_URL = "/assets/players/rewardlevel/";

/** Icon per competitive rank number (1 Bronze I … 19 Strikers Titan); 0 is unranked. */
export const COMPETITIVE_RANK_ICON_BY_NUMBER: Readonly<Record<number, string>> = {
  1: "1-bronze-I.png",
  2: "1-bronze-II.png",
  3: "1-bronze-III.png",
  4: "2-silver-I.png",
  5: "2-silver-II.png",
  6: "2-silver-III.png",
  7: "3-gold-I.png",
  8: "3-gold-II.png",
  9: "3-gold-III.png",
  10: "4-platinum-I.png",
  11: "4-platinum-II.png",
  12: "4-platinum-III.png",
  13: "5-diamond-I.png",
  14: "5-diamond-II.png",
  15: "5-diamond-III.png",
  16: "6-master-I.png",
  17: "6-master-II.png",
  18: "6-master-III.png",
  19: "7-strikerstitan-b.png",
};

export interface SeasonRewardLevel {
  readonly name: string;
  readonly image: string;
}

/** Season reward tiers by order: 0 Unranked, 1 Bronze … 7 Strikers Titan. */
export const SEASON_REWARD_LEVEL_BY_ORDER: Readonly<Record<number, SeasonRewardLevel>> = {
  0: { name: "Unranked", image: "0-unranked.png" },
  1: { name: "Bronze", image: "1-bronze.png" },
  2: { name: "Silver", image: "2-silver.png" },
  3: { name: "Gold", image: "3-gold.png" },
  4: { name: "Platinum", image: "4-platinum.png" },
  5: { name: "Diamond", image: "5-diamond.png" },
  6: { name: "Master", image: "6-master.png" },
  7: { name: "Strikers Titan", image: "7-strikerstitan-b.png" },
};

export function versionedAssetUrl(url: string): string {
  return `${url}?v=${RANK_ICON_ASSET_VERSION}`;
}
