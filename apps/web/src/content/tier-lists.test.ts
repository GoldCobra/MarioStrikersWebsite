// The tier lists as text: every character of a game appears exactly once, and the hidden caption and the
// structured data carry the same ranking.

import assert from "node:assert/strict";
import test from "node:test";
import { TIER_LISTS, tierListJsonLd, tierListText } from "./tier-lists.ts";

const ROSTERS: Record<keyof typeof TIER_LISTS, readonly number[]> = {
  msbl: [16],
  msc: [12, 8],
  sms: [9, 4],
};

test("each group ranks the whole roster once", () => {
  for (const [game, list] of Object.entries(TIER_LISTS)) {
    const sizes = list.groups.map((group) => {
      const names = group.tiers.flatMap((tier) => tier.characters);
      assert.equal(new Set(names).size, names.length, `${game}: a character appears twice`);
      return names.length;
    });
    assert.deepEqual(sizes, ROSTERS[game as keyof typeof TIER_LISTS], game);
  }
});

test("the caption and the structured data tell the same ranking", () => {
  const list = TIER_LISTS.msc;
  const text = tierListText(list);
  assert.match(text, /^Mario Strikers Charged tier list, from best to weakest\. Captains: S\+ tier: Waluigi\./);
  assert.match(text, /D tier: Bowser Jr\. Sidekicks: S tier: Boo\./);
  const [captains, sidekicks] = tierListJsonLd(list, "https://mariostrikers.gg/msc-tierlist");
  assert.ok(captains && sidekicks);
  assert.equal(captains.numberOfItems, 12);
  assert.equal(sidekicks.numberOfItems, 8);
  assert.deepEqual((captains.itemListElement as { name: string; description: string }[])[0], {
    "@type": "ListItem",
    position: 1,
    name: "Waluigi",
    description: "S+ tier",
  });
});
