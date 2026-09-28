import { test } from "@playwright/test";
import { expectScreenshot } from "../lib/approvals.ts";
import { expandViewportToDocument, hideDevNotice, preparePage, settle } from "../lib/browser.ts";
import { PAGE_SLUGS, PAGE_WIDTHS, pagePath } from "../lib/site.ts";

// Every public page at every supported width: the first screen as a visitor sees it,
// then the full length of the page.
for (const width of PAGE_WIDTHS) {
  test.describe(`pages @${width}`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const slug of PAGE_SLUGS) {
      test(slug, async ({ page }) => {
        await preparePage(page);
        await page.goto(pagePath(slug));
        await settle(page, { eagerImages: true });
        await hideDevNotice(page);
        await expectScreenshot(page, "pages", `${slug}-${width}-top.png`);
        await expandViewportToDocument(page, width);
        await expectScreenshot(page, "pages", `${slug}-${width}-full.png`);
      });
    }
  });
}
