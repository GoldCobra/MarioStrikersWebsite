// The current tier list image of each game.

export type TierListGame = "msbl" | "msc" | "sms";

export interface TierListImage {
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

export const TIER_LISTS: Readonly<Record<TierListGame, TierListImage>> = {
  msbl: { src: "/assets/tierlists/msbl-tierlist-current.webp?v=20260527-all-v1", width: 826, height: 774 },
  msc: { src: "/assets/tierlists/msc-tierlist-current.webp?v=20260527-all-v1", width: 1135, height: 774 },
  sms: { src: "/assets/tierlists/sms-tierlist-current.webp?v=20260527-all-v1", width: 1003, height: 384 },
};

/** Tier lists are drawn at 65% of the image width. */
export function displayWidth(image: TierListImage): number {
  return Math.round(image.width * 65) / 100;
}
