import { expect, test, type Page } from "@playwright/test";
import { expandViewportToDocument, hideDevNotice, login, preparePage, settle } from "../lib/browser.ts";
import { STATE_WIDTHS } from "../lib/site.ts";

// Interactive and failure states that a plain page load never shows.
interface VisualState {
  name: string;
  path: string;
  widths?: readonly number[];
  login?: "linked" | "unlinked";
  failApi?: boolean;
  fullPage?: boolean;
  act?: (page: Page) => Promise<void>;
}

async function clickAndSettle(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().click();
  await settle(page, { eagerImages: true });
}

async function openGearBuilderPane(page: Page, which: "first" | "last"): Promise<void> {
  const tabs = page.locator('.tab-link-icon[aria-controls^="tab-"]');
  const tab = which === "first" ? tabs.first() : tabs.last();
  const paneId = await tab.getAttribute("aria-controls");
  await tab.click();
  await page.locator(`#${paneId}[data-pane-load-state="loaded"]`).waitFor();
  await settle(page, { eagerImages: true });
}

const STATES: VisualState[] = [
  { name: "players-popup", path: "/players", act: (page) => clickAndSettle(page, ".players-name-trigger[data-player-id]") },
  { name: "leaderboard-popup", path: "/msbl-elo1v1", act: (page) => clickAndSettle(page, ".lb-player-trigger[data-player-id]") },
  { name: "whr-popup", path: "/msc-whr", act: (page) => clickAndSettle(page, ".lb-player-trigger[data-player-id]") },
  { name: "club-popup", path: "/msbl-striker-clubs", act: (page) => clickAndSettle(page, ".msbl-club-row[data-club-id]") },
  { name: "account-menu", path: "/", login: "linked", act: (page) => clickAndSettle(page, ".global-account-trigger") },
  { name: "profile-linked", path: "/profile", login: "linked", fullPage: true },
  { name: "profile-unlinked", path: "/profile", login: "unlinked", fullPage: true },
  { name: "error-leaderboard", path: "/msbl-elo1v1", failApi: true, fullPage: true },
  { name: "error-players", path: "/players", failApi: true, fullPage: true },
  { name: "error-clubs", path: "/msbl-striker-clubs", failApi: true, fullPage: true },
  { name: "error-home", path: "/", failApi: true, fullPage: true },
  { name: "error-events", path: "/community-tournaments", failApi: true, fullPage: true },
  { name: "error-wiimmfi", path: "/msc-wiimmfi", failApi: true, fullPage: true },
  { name: "error-profile-popup", path: "/players", act: async (page) => {
    await page.route("**/api/players/*/profile", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Simulated failure."}' }));
    await clickAndSettle(page, ".players-name-trigger[data-player-id]");
  } },
  { name: "gear-builder-first-pane", path: "/msbl-gear-builder", fullPage: true, act: (page) => openGearBuilderPane(page, "first") },
  { name: "gear-builder-last-pane", path: "/msbl-gear-builder", fullPage: true, act: (page) => openGearBuilderPane(page, "last") },
  { name: "placeholder-construction", path: "/tab-placeholder?state=construction", fullPage: true },
  { name: "placeholder-tba", path: "/tab-placeholder?state=tba", fullPage: true },
  { name: "nav-hover", path: "/competitive-rules", widths: [1280], act: async (page) => {
    await page.locator(".nav-top-link").nth(2).hover();
    await settle(page);
  } }
];

for (const state of STATES) {
  for (const width of state.widths ?? STATE_WIDTHS) {
    test(`${state.name} @${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await preparePage(page, { failApi: state.failApi });
      if (state.login) await login(page, state.login);
      await page.goto(state.path);
      await settle(page, { eagerImages: true });
      if (state.act) await state.act(page);
      await hideDevNotice(page);
      if (state.fullPage) await expandViewportToDocument(page, width);
      await expect(page).toHaveScreenshot(["states", `${state.name}-${width}.png`]);
    });
  }
}
