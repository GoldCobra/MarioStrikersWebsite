import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { resolvePageState } from "@ms/shared/site/page-state";
import { PAGES } from "@ms/shared/site/pages";
import { renderContentTabs, renderFooter, renderMainNav, renderSubNav } from "./site-shell.ts";

const PAGES_DIR = path.join(import.meta.dirname, "..", "pages");

test("every registered page has a page file and every page file is registered", () => {
  const files = [
    "index",
    ...readdirSync(path.join(PAGES_DIR, "pages"))
      .filter((file) => file.endsWith(".astro"))
      .map((file) => file.slice(0, -".astro".length)),
  ];
  assert.deepEqual(files.sort(), PAGES.map((page) => page.slug).sort());
});

test("the active section and page are marked in the navigation", () => {
  const state = resolvePageState("msbl-gear-builder");
  const nav = renderMainNav(state);
  assert.match(nav, /<a class="nav-top-link is-active" href="\/games" data-top-key="games" aria-label="Games">/);
  assert.match(nav, /nav-games-active\.webp/);
  assert.doesNotMatch(nav, /aria-current/);
  assert.match(
    renderMainNav(resolvePageState("index")),
    /href="\/" data-top-key="home" aria-label="Home" aria-current="page">/,
  );

  const subNav = renderSubNav(state);
  assert.match(subNav, /^<nav class="sub-nav sub-nav-level2" aria-label="Games navigation">/);
  assert.match(
    subNav,
    /<a class="sub-link sub-link-text is-active" href="\/msbl" aria-label="STRIKERS: BATTLE LEAGUE">/,
  );
  assert.equal(renderSubNav(resolvePageState("partners")), "");
});

test("content tabs list visible leaves and skip leaderboards", () => {
  const tabs = renderContentTabs(resolvePageState("msc-setup-guide"));
  assert.match(tabs, /aria-label="MSC tabs"/);
  assert.match(
    tabs,
    /<a class="global-tab is-active" href="\/msc-setup-guide" aria-label="Setup Guide" aria-current="page">SETUP GUIDE<\/a>/,
  );
  // The Wiimmfi page exists but has no tab.
  assert.doesNotMatch(tabs, /wiimmfi/);
  assert.equal(renderContentTabs(resolvePageState("msbl-elo1v1")), "");
  assert.equal(renderContentTabs(resolvePageState("games")), "");
});

test("the footer links the community channels and the legal pages", () => {
  const footer = renderFooter();
  assert.equal(footer.match(/class="global-footer-link"/g)?.length, 6);
  assert.equal(footer.match(/class="global-footer-sep"/g)?.length, 5);
  assert.match(
    footer,
    /<a href="https:\/\/discord\.gg\/de2YaWg" class="global-footer-link" target="_blank" rel="noopener noreferrer">DISCORD<\/a>/,
  );
  assert.match(footer, /<a href="\/privacy-policy" class="global-footer-link">PRIVACY POLICY<\/a><\/p><\/footer>$/);
});
