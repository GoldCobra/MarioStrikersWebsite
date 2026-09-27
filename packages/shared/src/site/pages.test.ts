import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PAGE_CONTEXT_MAP, SECTION_MODELS, TOP_NAV_ITEMS } from "./navigation.ts";
import { PAGES, canonicalUrl, findPage, isIndexable, pagePath } from "./pages.ts";
import { pageFile } from "./routes.ts";

const publicRoot = join(import.meta.dirname, "../../../../apps/web/public");

test("the registry lists every page file exactly once", () => {
  const slugs = PAGES.map((page) => page.slug);
  assert.equal(new Set(slugs).size, slugs.length, "duplicate slug");
  const files = readdirSync(join(publicRoot, "pages"))
    .filter((file) => file.endsWith(".html"))
    .map((file) => file.slice(0, -".html".length));
  assert.deepEqual([...slugs].filter((slug) => slug !== "index").sort(), files.sort());
  for (const slug of slugs) assert.ok(existsSync(join(publicRoot, pageFile(slug))), slug);
});

test("every page has a title and a description, and no two pages share them", () => {
  for (const page of PAGES) {
    assert.ok(page.title.trim(), page.slug);
    assert.ok(page.description.trim(), page.slug);
  }
  assert.equal(new Set(PAGES.map((page) => page.title)).size, PAGES.length, "duplicate title");
  assert.equal(new Set(PAGES.map((page) => page.description)).size, PAGES.length, "duplicate description");
});

test("navigation only points at registered pages", () => {
  const known = (slug: string): boolean => findPage(slug) !== undefined;
  for (const item of TOP_NAV_ITEMS) assert.ok(known(item.slug), item.slug);
  for (const section of Object.values(SECTION_MODELS)) {
    assert.ok(known(section.overviewSlug), section.overviewSlug);
    for (const second of section.items) {
      assert.ok(known(second.slug), second.slug);
      for (const leaf of second.children ?? []) {
        assert.ok(known(leaf.slug), leaf.slug);
        for (const slug of leaf.matchSlugs ?? []) assert.ok(known(slug), slug);
      }
    }
  }
  for (const slug of Object.keys(PAGE_CONTEXT_MAP)) assert.ok(known(slug), slug);
});

test("URLs are clean and canonical", () => {
  assert.equal(pagePath("index"), "/");
  assert.equal(pagePath("msc-tierlist"), "/msc-tierlist");
  assert.equal(canonicalUrl("index"), "https://mariostrikers.gg/");
  assert.equal(canonicalUrl("msc-tierlist"), "https://mariostrikers.gg/msc-tierlist");
  assert.equal(PAGES.filter(isIndexable).length, 26);
});
