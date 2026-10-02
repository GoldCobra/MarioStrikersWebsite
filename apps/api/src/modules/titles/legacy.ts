// Legacy ranks (dbo.PlayerStats.Rank / Rank2v2, frozen since the competitive ranks began): their tiers and
// when a stored rank counts. One rule for the legacy rank titles (rules.ts) and MY PROFILE's Highest Legacy
// Rank (profile/stats.ts); no database code here, so the fixtures can use it too.

/** The tier names, ascending: 1 Rookie < 2 Professional < 3 Superstar < 4 Legend < 5 Megastriker. */
export const LEGACY_RANK_NAMES = ["", "Rookie", "Professional", "Superstar", "Legend", "Megastriker"] as const;

/** Legacy matches a rank needed before it showed (dbo.tr_UpdateRank): 10 in 1v1, 4 in 2v2. */
export const LEGACY_MIN_MATCHES = { "1v1": 10, "2v2": 4 } as const;

/** The legacy rank tier of a PlayerStats rank: 1-3 Rookie, 4-6 Professional … 13 Megastriker; 0 for none. */
export function legacyTier(rank: number): number {
  return Number.isInteger(rank) && rank >= 1 && rank <= 13 ? Math.floor((rank - 1) / 3) + 1 : 0;
}

/** A tier's name (legacyTier); "" for none. */
export function legacyTierName(tier: number): string {
  return LEGACY_RANK_NAMES[tier] ?? "";
}

/**
 * The tier a stored legacy rank counts for: its tier when the player had the legacy matches it needed before
 * the competitive start, else 0 (the rank rests on matches played after the legacy system stopped).
 */
export function countedLegacyTier(row: {
  readonly mode: "1v1" | "2v2";
  readonly rank: number;
  readonly matchesBefore: number;
}): number {
  return row.matchesBefore >= LEGACY_MIN_MATCHES[row.mode] ? legacyTier(row.rank) : 0;
}
