// Sitemap dates: a page takes the newest date of its page file and the content its family renders.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadLastmod, pageFile, pageLastmod } from "./lastmod.ts";

const DATES = {
  "apps/web/src/pages/pages/msc-competitiverules.astro": "2026-09-20T10:00:00+02:00",
  "apps/web/src/content/competitive-rules/rules.ts": "2026-09-27T18:00:00+02:00",
  "apps/web/src/pages/pages/about-us.astro": "2026-08-01T12:00:00+02:00",
  "apps/web/src/content/tier-lists.ts": "2026-09-28T09:00:00+02:00",
  "apps/web/src/layouts/SiteLayout.astro": "2026-09-28T20:00:00+02:00",
};

test("a family page takes the newest of its file and its content", () => {
  const rules = pageLastmod("msc-competitiverules", DATES, '<RulesPage slug="msc-competitiverules" />');
  assert.equal(rules, "2026-09-27T18:00:00+02:00");
});

test("a plain page takes its own file's date; layout changes do not count", () => {
  assert.equal(pageLastmod("about-us", DATES, '<SiteLayout slug="about-us">'), "2026-08-01T12:00:00+02:00");
  assert.equal(pageLastmod("msbl-whr", DATES, "<LeaderboardPage />"), undefined);
  assert.equal(pageFile("index"), "apps/web/src/pages/index.astro");
});

test("without a recorded file there are no dates", () => {
  assert.equal(loadLastmod(path.join(os.tmpdir(), "missing-lastmod.json")), null);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lastmod-")), "lastmod.json");
  fs.writeFileSync(file, JSON.stringify(DATES));
  assert.deepEqual(loadLastmod(file), DATES);
});
