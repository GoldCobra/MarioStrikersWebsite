// The current tier list of each game: the published image and the same ranking as text, which the page
// offers to search engines and screen readers (a hidden caption and ItemList structured data).
// Update both together when a new tier list image is published.

export type TierListGame = "msbl" | "msc" | "sms";

export interface TierListImage {
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

export interface Tier {
  readonly tier: string;
  readonly characters: readonly string[];
}

export interface TierGroup {
  /** "Captains" or "Sidekicks" where a game ranks them separately. */
  readonly title?: string;
  readonly tiers: readonly Tier[];
}

export interface TierList {
  readonly game: string;
  readonly image: TierListImage;
  readonly groups: readonly TierGroup[];
}

export const TIER_LISTS: Readonly<Record<TierListGame, TierList>> = {
  msbl: {
    game: "Mario Strikers: Battle League",
    image: { src: "/assets/tierlists/msbl-tierlist-current.webp?v=20260527-all-v1", width: 826, height: 774 },
    groups: [
      {
        tiers: [
          { tier: "S+", characters: ["Waluigi"] },
          { tier: "S", characters: ["Pauline", "Toad", "Donkey Kong", "Peach"] },
          { tier: "A", characters: ["Bowser", "Diddy Kong"] },
          { tier: "B", characters: ["Bowser Jr.", "Mario", "Shy Guy", "Birdo", "Wario"] },
          { tier: "C", characters: ["Luigi", "Rosalina", "Daisy"] },
          { tier: "D", characters: ["Yoshi"] },
        ],
      },
    ],
  },
  msc: {
    game: "Mario Strikers Charged",
    image: { src: "/assets/tierlists/msc-tierlist-current.webp?v=20260527-all-v1", width: 1135, height: 774 },
    groups: [
      {
        title: "Captains",
        tiers: [
          { tier: "S+", characters: ["Waluigi"] },
          { tier: "S", characters: ["Petey Piranha", "Donkey Kong"] },
          { tier: "A", characters: ["Daisy", "Wario", "Bowser"] },
          { tier: "B", characters: ["Luigi", "Mario", "Diddy Kong"] },
          { tier: "C", characters: ["Yoshi", "Peach"] },
          { tier: "D", characters: ["Bowser Jr."] },
        ],
      },
      {
        title: "Sidekicks",
        tiers: [
          { tier: "S", characters: ["Boo"] },
          { tier: "A", characters: ["Birdo", "Dry Bones"] },
          { tier: "B", characters: ["Hammer Bros.", "Monty Mole"] },
          { tier: "C", characters: ["Toad", "Koopa Troopa", "Shy Guy"] },
        ],
      },
    ],
  },
  sms: {
    game: "Super Mario Strikers",
    image: { src: "/assets/tierlists/sms-tierlist-current.webp?v=20260527-all-v1", width: 1003, height: 384 },
    groups: [
      {
        title: "Captains",
        tiers: [
          { tier: "S", characters: ["Daisy", "Peach"] },
          { tier: "A", characters: ["Mario", "Yoshi", "Super Team", "Luigi"] },
          { tier: "B", characters: ["Waluigi", "Wario", "Donkey Kong"] },
        ],
      },
      {
        title: "Sidekicks",
        tiers: [
          { tier: "S", characters: ["Toad"] },
          { tier: "A", characters: ["Birdo"] },
          { tier: "B", characters: ["Koopa Troopa", "Hammer Bros."] },
        ],
      },
    ],
  },
};

/** Tier lists are drawn at 65% of the image width. */
export function displayWidth(image: TierListImage): number {
  return Math.round(image.width * 65) / 100;
}

/** The ranking as one sentence per group, e.g. "Captains: S+ tier: Waluigi. S tier: …". */
export function tierListText(list: TierList): string {
  const groups = list.groups.map((group) => {
    const tiers = group.tiers
      .map((entry) => {
        const names = entry.characters.join(", ");
        // "Bowser Jr." already ends the sentence.
        return `${entry.tier} tier: ${names}${names.endsWith(".") ? "" : "."}`;
      })
      .join(" ");
    return group.title ? `${group.title}: ${tiers}` : tiers;
  });
  return `${list.game} tier list, from best to weakest. ${groups.join(" ")}`;
}

/** One schema.org ItemList per group, best first. */
export function tierListJsonLd(list: TierList, pageUrl: string): Record<string, unknown>[] {
  return list.groups.map((group) => {
    const items = group.tiers.flatMap((entry) => entry.characters.map((name) => ({ name, tier: entry.tier })));
    return {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: `${list.game} tier list${group.title ? ` (${group.title.toLowerCase()})` : ""}`,
      url: pageUrl,
      itemListOrder: "https://schema.org/ItemListOrderDescending",
      numberOfItems: items.length,
      itemListElement: items.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        description: `${item.tier} tier`,
      })),
    };
  });
}
