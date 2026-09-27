// Rank tiers of the legacy WHR ladder, as encoded in the Discord emoji of GetRatingsForDiscord lines.

import { toText } from "@ms/shared/text";

export interface WhrRank {
  readonly level: number;
  readonly code: string;
  readonly name: string;
}

export const RANK_ORDER: readonly WhrRank[] = [
  { level: 1, code: "rookie", name: "Rookie" },
  { level: 2, code: "professional", name: "Professional" },
  { level: 3, code: "superstar", name: "Superstar" },
  { level: 4, code: "legend", name: "Legend" },
  { level: 5, code: "megastriker", name: "Megastriker" },
];

const RANK_BY_CODE = new Map(RANK_ORDER.map((rank) => [rank.code, rank]));

export function normalizeCompetitiveRank(value: unknown): WhrRank | null {
  const raw = toText(value).trim().toLowerCase();
  if (!raw) return null;
  if (/^[1-5]$/.test(raw)) return RANK_ORDER.find((rank) => rank.level === Number(raw)) ?? null;
  const cleaned = raw.replace(/[^a-z0-9]/g, "");
  if (cleaned === "mega") return RANK_BY_CODE.get("megastriker") ?? null;
  return RANK_BY_CODE.get(cleaned) ?? null;
}
