import assert from "node:assert/strict";
import test from "node:test";
import { availableTitles, normalizeTitleCode, selectedTitle, titleText, toTitleOption } from "./availability.ts";
import { seededCatalog } from "./catalog.ts";

const CATALOG = seededCatalog();
const id = (code: string): number => CATALOG.find((title) => title.code === code)?.id ?? 0;
const codes = (unlocked: readonly string[]): string[] =>
  availableTitles(CATALOG, unlocked.map(id)).map((title) => title.code);

test("every player can select every Free Title, also new ones, without unlock rows", () => {
  const free = CATALOG.filter((title) => title.category === "free").map((title) => title.code);
  assert.deepEqual(codes([]), free);
  const last = CATALOG.at(-1);
  assert.ok(last);
  const added = [...CATALOG, { ...last, id: 999, code: "new-free", sortOrder: 99 }];
  assert.ok(availableTitles(added, []).some((title) => title.code === "new-free"));
});

test("unlocked titles come first, by category and their place in the list", () => {
  assert.deepEqual(codes(["legacy-legend", "msl-2023-world-champion", "tournament-winner"]).slice(0, 4), [
    "msl-2023-world-champion",
    "tournament-winner",
    "legacy-legend",
    "super-mario-strikers-fan",
  ]);
});

test("of an exclusive group only the highest unlocked level is offered", () => {
  const offered = codes([
    "legacy-rookie",
    "legacy-superstar",
    "tournament-winner",
    "tournament-winner-green",
    "msl-2-time-world-champion",
    "msl-3-time-world-champion",
  ]);
  assert.ok(offered.includes("legacy-superstar") && !offered.includes("legacy-rookie"));
  assert.ok(offered.includes("tournament-winner-green") && !offered.includes("tournament-winner"));
  assert.ok(offered.includes("msl-3-time-world-champion") && !offered.includes("msl-2-time-world-champion"));
});

test("an inactive title is offered to nobody, unlocked or not", () => {
  const retired = CATALOG.map((title) =>
    title.code === "og-player" || title.code === "legacy-legend" ? { ...title, isActive: false } : title,
  );
  const offered = availableTitles(retired, [id("legacy-legend"), id("legacy-rookie")]).map((title) => title.code);
  assert.ok(!offered.includes("og-player") && !offered.includes("legacy-legend"));
  assert.ok(offered.includes("legacy-rookie"), "the next level of the group takes its place");
});

test("the selected title counts only while the player can select it", () => {
  assert.equal(selectedTitle(CATALOG, [], id("og-player"))?.code, "og-player");
  assert.equal(selectedTitle(CATALOG, [], id("msl-2023-world-champion")), null);
  assert.equal(selectedTitle(CATALOG, [id("legacy-rookie"), id("legacy-legend")], id("legacy-rookie")), null);
  assert.equal(selectedTitle(CATALOG, [], null), null);
});

test("titles are shown in FULL CAPS and codes taken in lower case", () => {
  assert.equal(titleText("  og player "), "OG PLAYER");
  assert.equal(normalizeTitleCode(" OG-Player "), "og-player");
  const green = CATALOG.find((title) => title.code === "tournament-winner-green");
  assert.ok(green);
  assert.deepEqual(toTitleOption(green), {
    code: "tournament-winner-green",
    name: "TOURNAMENT WINNER",
    category: "tournament",
    categoryName: "Tournament Titles",
    style: "green",
  });
});
