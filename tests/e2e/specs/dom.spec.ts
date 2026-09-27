import { expect, test } from "@playwright/test";
import { preparePage, settle } from "../lib/browser.ts";
import { snapshotDocument } from "../lib/dom.ts";
import { DOM_WIDTH, PAGE_SLUGS, pagePath } from "../lib/site.ts";

// Committed goldens of the rendered markup and head metadata. They prove that static markup
// generated at build time equals what the old runtime scripts produced.
test.use({ viewport: { width: DOM_WIDTH, height: 900 } });

for (const slug of PAGE_SLUGS) {
  test(slug, async ({ page }) => {
    await preparePage(page);
    await page.goto(pagePath(slug));
    await settle(page);
    const snapshot = await page.evaluate(snapshotDocument);
    expect(snapshot.body).toMatchSnapshot(["dom", `${slug}.txt`]);
    expect(snapshot.head).toMatchSnapshot(["head", `${slug}.json`]);
  });
}
