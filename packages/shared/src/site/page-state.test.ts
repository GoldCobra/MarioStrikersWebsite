import assert from "node:assert/strict";
import { test } from "node:test";
import { breadcrumbItems, pageLabel, resolvePageState } from "./page-state.ts";
import { PAGES } from "./pages.ts";

function path(slug: string): string[] {
  const state = resolvePageState(slug);
  return [state.topKey, state.secondItem?.key ?? "-", state.leafItem?.key ?? "-"];
}

test("pages resolve to their place in the navigation", () => {
  assert.deepEqual(path("index"), ["home", "-", "-"]);
  assert.deepEqual(path("partners"), ["partners", "-", "-"]);
  assert.deepEqual(path("games"), ["games", "-", "-"]);
  assert.deepEqual(path("msbl-gear-builder"), ["games", "msbl", "gear-builder"]);
  // Every mode of a leaderboard belongs to its game's leaf.
  assert.deepEqual(path("msbl-whr"), ["competitive", "leaderboards", "msbl"]);
  assert.deepEqual(path("profile"), ["players", "-", "-"]);
  assert.deepEqual(path("players-profiles"), ["players", "-", "-"]);
  // Pages outside every section fall back to home, as the runtime script did.
  assert.deepEqual(path("about-us"), ["home", "-", "-"]);
  // The not-found page marks no navigation entry.
  assert.deepEqual(path("404"), ["", "-", "-"]);
  for (const page of PAGES) assert.notEqual(resolvePageState(page.slug).topKey, "", page.slug);
});

test("breadcrumbs follow the navigation and are omitted on noindex pages", () => {
  const state = resolvePageState("msbl-whr");
  assert.deepEqual(
    breadcrumbItems(state, "MSBL WHR")?.map((item) => [item.position, item.name, item.item]),
    [
      [1, "Home", "https://mariostrikers.gg/"],
      [2, "Competitive", "https://mariostrikers.gg/competitive"],
      [3, "Leaderboards", "https://mariostrikers.gg/competitive-leaderboards"],
      [4, "MSBL", "https://mariostrikers.gg/msbl-elo1v1"],
      [5, "MSBL WHR", "https://mariostrikers.gg/msbl-whr"],
    ],
  );
  assert.deepEqual(breadcrumbItems(resolvePageState("index"), "Mario Strikers Community")?.length, 1);
  assert.deepEqual(
    breadcrumbItems(resolvePageState("about-us"), "About Us")?.map((item) => item.name),
    ["Home", "About Us"],
  );
  assert.equal(breadcrumbItems(resolvePageState("games"), "Games"), null);
});

test("the page label is the title before the site name", () => {
  assert.equal(pageLabel("MSBL WHR | Mario Strikers Community"), "MSBL WHR");
  assert.equal(pageLabel("Mario Strikers Community"), "Mario Strikers Community");
  assert.equal(pageLabel(""), "Home");
});
