import { expect, test, type Page } from "@playwright/test";
import { login, preparePage, settle } from "../lib/browser.ts";
import { MSBL_SAVE, MSC_SAVE_PAL, buildOnlineFile } from "../lib/save-files.ts";
import { DOM_WIDTH, PAGE_SLUGS, pagePath } from "../lib/site.ts";

// The Content Security Policy of infra/nginx/snippets/document-headers.conf, which the local site server
// sends too: no page and no interaction may trip it. Violations fire as events whether the policy is
// enforced or only reported.
test.use({ viewport: { width: DOM_WIDTH, height: 900 } });

async function watchViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const record: string[] = [];
    Object.defineProperty(window, "__cspViolations", { value: record });
    document.addEventListener("securitypolicyviolation", (event) => {
      record.push(
        `${event.effectiveDirective} ${event.blockedURI || "inline"} (${event.sourceFile}:${event.lineNumber})`,
      );
    });
  });
}

async function violations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
}

async function open(page: Page, path: string): Promise<void> {
  await watchViolations(page);
  await preparePage(page);
  await page.goto(path);
  await settle(page, { eagerImages: true });
}

test("the page sends the policy", async ({ page }) => {
  const response = await page.goto(pagePath("index"));
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"] ?? headers["content-security-policy-report-only"]).toContain(
    "default-src 'self'",
  );
});

for (const slug of PAGE_SLUGS) {
  test(`page ${slug}`, async ({ page }) => {
    await open(page, pagePath(slug));
    expect(await violations(page)).toEqual([]);
  });
}

const FLOWS: Record<string, (page: Page) => Promise<void>> = {
  "player popup": async (page) => {
    await open(page, "/players");
    await page.locator(".players-name-trigger[data-player-id]").first().click();
    await settle(page, { eagerImages: true });
  },
  "club popup": async (page) => {
    await open(page, "/msbl-striker-clubs");
    await page.locator(".msbl-club-row[data-club-id]").first().click();
    await settle(page, { eagerImages: true });
  },
  "leaderboard popup": async (page) => {
    await open(page, "/msbl-elo1v1");
    await page.locator(".lb-player-trigger[data-player-id]").first().click();
    await settle(page, { eagerImages: true });
  },
  "signed-in profile": async (page) => {
    await watchViolations(page);
    await preparePage(page);
    await login(page, "linked");
    await page.goto("/profile");
    await settle(page, { eagerImages: true });
  },
  "gear builder panes, character menu and card picture": async (page) => {
    await open(page, "/msbl-gear-builder");
    const tabs = page.locator('.tab-link-icon[aria-controls^="tab-"]');
    let paneId = "";
    for (const tab of [tabs.first(), tabs.last()]) {
      paneId = (await tab.getAttribute("aria-controls")) ?? "";
      await tab.click();
      await page.locator(`#${paneId}[data-pane-load-state="loaded"]`).waitFor();
    }
    // The snapshot's onclick attribute, which the host turns into a listener.
    await page.locator("#mySelectLabel").dispatchEvent("click");
    await expect(page.locator("#mySelectOptions")).toHaveCSS("display", "block");
    // Saving the card picture renders it with html2canvas (an inner frame and a canvas).
    const saved = page.waitForEvent("download").then(() => "saved" as const);
    await page.locator(`#${paneId} .savepic`).first().dispatchEvent("click");
    // The page runs on the virtual clock: advance it until the file arrives.
    for (let step = 0; step < 40; step += 1) {
      if ((await Promise.race([saved, settle(page).then(() => "waiting" as const)])) === "saved") break;
    }
    expect(await saved).toBe("saved");
  },
  "save editors": async (page) => {
    await open(page, "/msbl-save-editor");
    await page.setInputFiles("#msbl-save-editor-file-input", {
      name: "strkrs.save",
      mimeType: "application/octet-stream",
      buffer: MSBL_SAVE,
    });
    await expect(page.locator("#msbl-save-editor-status")).not.toHaveText("");
    expect(await violations(page)).toEqual([]);
    await page.goto("/msc-save-editor");
    await settle(page, { eagerImages: true });
    await page.setInputFiles("#save-editor-file-input", {
      name: "Strikers2",
      mimeType: "application/octet-stream",
      buffer: MSC_SAVE_PAL,
    });
    await expect(page.locator("#save-editor-status")).not.toHaveText("");
    await page.click("#save-editor-mode-friendlist");
    await page.setInputFiles("#online-editor-file-input", {
      name: "Online",
      mimeType: "application/octet-stream",
      buffer: buildOnlineFile(),
    });
    await expect(page.locator("#online-editor-status")).not.toHaveText("");
    await settle(page, { eagerImages: true });
  },
};

for (const [name, flow] of Object.entries(FLOWS)) {
  test(`flow ${name}`, async ({ page }) => {
    await flow(page);
    expect(await violations(page)).toEqual([]);
  });
}
