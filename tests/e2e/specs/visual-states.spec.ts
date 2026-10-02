import { test, type Page } from "@playwright/test";
import { expectScreenshot } from "../lib/approvals.ts";
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
  /** Set up before the page loads, e.g. a changed API answer. */
  route?: (page: Page) => Promise<void>;
  act?: (page: Page) => Promise<void>;
}

/**
 * The profile of a player with another title, as the API sends a title of that look (title_style) and game
 * (title_game_code; a reference commit from before the game balls ignores it).
 */
function withTitle(playerId: number, title: string, look: string, game = ""): (page: Page) => Promise<void> {
  return async (page) => {
    await page.route(`**/api/players/${String(playerId)}/profile`, async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { player?: Record<string, unknown> };
      const player = { ...body.player, title, title_style: look, title_game_code: game };
      await route.fulfill({ response, json: { ...body, player } });
    });
  };
}

async function clickAndSettle(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().click();
  await settle(page, { eagerImages: true });
}

async function showPlayerCard(page: Page): Promise<void> {
  // A reference commit from before the page shows its 404 page instead, without the card.
  if (await page.locator("main.player-card-page").count()) {
    await page.locator("html[data-player-card='ready']").waitFor();
  }
  await settle(page, { eagerImages: true });
}

// Editing on the profile page: a pencil or "+" opens a field (a reference commit from before the draft
// editing has no such buttons: then nothing opens).
async function openProfileField(page: Page, selector: string): Promise<boolean> {
  const button = page.locator(selector).first();
  if (!(await button.count())) return false;
  // The local notice sits where the save bar floats.
  await hideDevNotice(page);
  await button.click();
  await page.locator("[data-edit-row]").first().waitFor();
  await settle(page, { eagerImages: true });
  return true;
}

/** The country picked in the open country field, as typed. */
async function pickCountry(page: Page, typed: string): Promise<void> {
  const combobox = page.locator("[role='combobox']");
  await combobox.press("ArrowDown");
  await page.keyboard.type(typed);
  await page.keyboard.press("Enter");
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
  {
    name: "players-popup",
    path: "/players",
    act: (page) => clickAndSettle(page, ".players-name-trigger[data-player-id]"),
  },
  {
    // The compact card the Discord bot screenshots for /profile show; player 1 is a world champion
    // with four rating cards, so the card is taller than 350px and scaled down to fit.
    name: "player-card",
    path: "/player-card?player=1",
    act: showPlayerCard,
  },
  {
    // Player 3 has one friend code and one row of rating cards, so the card is only as tall as that.
    name: "player-card-short",
    path: "/player-card?player=3",
    act: showPlayerCard,
  },
  {
    // A player title, the content's first line before the friend codes: player 5's legacy rank, grey.
    name: "player-card-title",
    path: "/player-card?player=5",
    act: showPlayerCard,
  },
  {
    // A title with a glow under a world champion's gold bar: MSL WORLD CHAMPION, yellow with an orange glow,
    // after the MSBL ball.
    name: "player-card-title-glow",
    path: "/player-card?player=2",
    route: withTitle(2, "MSL 2025 WORLD CHAMPION", "msl-world", "MSBL"),
    act: showPlayerCard,
  },
  {
    // Player 2, a world champion, has the longest free title (grey).
    name: "players-popup-title",
    path: "/players",
    act: (page) => clickAndSettle(page, '.players-name-trigger[data-player-id="2"]'),
  },
  {
    // A special pre-2014 title: light cyan with a blue glow, no game.
    name: "players-popup-title-glow",
    path: "/players",
    route: withTitle(5, "WFC FINAL SEASON LEADER", "special"),
    act: (page) => clickAndSettle(page, '.players-name-trigger[data-player-id="5"]'),
  },
  {
    // A title of a game in the popup: the green TOURNAMENT WINNER of MSC after the MSC ball.
    name: "players-popup-title-ball",
    path: "/players",
    route: withTitle(5, "TOURNAMENT WINNER", "tournament-x5", "MSC"),
    act: (page) => clickAndSettle(page, '.players-name-trigger[data-player-id="5"]'),
  },
  {
    // Season Rewards and Tourney Accolades open: the entries in the player title's type, the won MSL World
    // Championship in the title's gold (player 1, a world champion).
    name: "players-popup-accolades",
    path: "/players",
    act: async (page) => {
      await clickAndSettle(page, '.players-name-trigger[data-player-id="1"]');
      for (const summary of await page.locator("#player-profile-popup details > summary").all()) await summary.click();
      await settle(page, { eagerImages: true });
    },
  },
  {
    // The fixture player 4 has no match in the current season, so every rating card is greyed out.
    name: "players-popup-inactive",
    path: "/players",
    act: (page) => clickAndSettle(page, '.players-name-trigger[data-player-id="4"]'),
  },
  {
    name: "leaderboard-popup",
    path: "/msbl-elo1v1",
    act: (page) => clickAndSettle(page, ".lb-player-trigger[data-player-id]"),
  },
  { name: "whr-popup", path: "/msc-whr", act: (page) => clickAndSettle(page, ".lb-player-trigger[data-player-id]") },
  {
    name: "club-popup",
    path: "/msbl-striker-clubs",
    act: (page) => clickAndSettle(page, ".msbl-club-row[data-club-id]"),
  },
  {
    // Signed in, the login button shows the avatar and opens the account menu (a reference commit from before
    // has the account widget at the top right instead).
    name: "account-menu",
    path: "/",
    login: "linked",
    act: async (page) => {
      const trigger = page.locator("button.nav-top-login");
      await clickAndSettle(page, (await trigger.count()) ? "button.nav-top-login" : ".global-account-trigger");
    },
  },
  { name: "profile-linked", path: "/profile", login: "linked", fullPage: true },
  { name: "profile-unlinked", path: "/profile", login: "unlinked", fullPage: true },
  {
    // An MSC code open for changing, its platform changed: marked unsaved, SAVE and DISCARD on.
    name: "profile-edit",
    path: "/profile",
    login: "linked",
    act: async (page) => {
      if (!(await openProfileField(page, "[data-edit-open^='msc:']"))) return;
      await page.locator("[data-edit-row] [data-field='platform']").selectOption("Dolphin");
      await settle(page);
    },
  },
  {
    // A profile created at login: no codes yet, the first MSC code being added.
    name: "profile-edit-new",
    path: "/profile",
    login: "unlinked",
    act: (page) => openProfileField(page, "[data-edit-action='add']").then(() => undefined),
  },
  {
    name: "profile-edit-errors",
    path: "/profile",
    login: "linked",
    act: async (page) => {
      if (!(await openProfileField(page, "[data-edit-open='switch']"))) return;
      await page.locator("[data-edit-row] .profile-edit-digits").first().fill("12");
      await page.locator("[data-edit-action='save']").click();
      await page.locator(".profile-toast").waitFor();
      await settle(page);
    },
  },
  {
    // The country field open with its flags, "s" typed.
    name: "profile-country-list",
    path: "/profile",
    login: "linked",
    act: async (page) => {
      if (!(await openProfileField(page, "[data-edit-open='country']"))) return;
      await page.locator("[role='combobox']").press("ArrowDown");
      await page.keyboard.type("s");
      await settle(page, { eagerImages: true });
    },
  },
  {
    // The title field open with a title picked from the member's titles, shown in its look (a reference
    // commit from before the list picks it in a plain select).
    name: "profile-title-edit",
    path: "/profile",
    login: "linked",
    act: async (page) => {
      if (!(await openProfileField(page, "[data-edit-open='title']"))) return;
      if (await page.locator("#profile-title-select").count()) {
        await page.locator("#profile-title-select").click();
        // Since 2026-10-02 the member holds its MSBL variant ("msl-2025-world-champion-msbl").
        await page.locator("[role='option'][data-value^='msl-2025-world-champion']").click();
      } else {
        await page.locator("[data-field='title']").selectOption("msl-2025-world-champion");
      }
      await settle(page);
    },
  },
  {
    // The title list open: the sample member has a title of every look, each in its colour and glow.
    name: "profile-title-list",
    path: "/profile",
    login: "linked",
    act: async (page) => {
      if (!(await openProfileField(page, "[data-edit-open='title']"))) return;
      const list = page.locator("#profile-title-select");
      if (await list.count()) await list.click();
      await settle(page, { eagerImages: true });
    },
  },
  {
    // DISCARD asks first.
    name: "profile-discard",
    path: "/profile",
    login: "linked",
    act: async (page) => {
      if (!(await openProfileField(page, "[data-edit-open='switch']"))) return;
      await page.locator("[data-edit-row] .profile-edit-digits").first().fill("9999");
      await page.locator("[data-edit-action='discard']").click();
      await settle(page);
    },
  },
  {
    // Saved elsewhere meanwhile: the API answers 409 with the newer profile; the member's change stays,
    // marked, and a message names what is saved now.
    name: "profile-edit-conflict",
    path: "/profile",
    login: "linked",
    act: async (page) => {
      if (!(await openProfileField(page, "[data-edit-open='country']"))) return;
      await page.route("**/api/profile/me/editable", async (route) => {
        if (route.request().method() !== "PUT") {
          await route.continue();
          return;
        }
        const current = (await (await route.fetch({ method: "GET" })).json()) as Record<string, unknown>;
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: "The profile was changed elsewhere since it was loaded.",
            code: "PROFILE_CHANGED",
            current: { ...current, version: "newer", country: "it" },
          }),
        });
      });
      await pickCountry(page, "united s");
      await page.locator("[data-edit-action='save']").click();
      await page.locator("[data-edit-row] .profile-edit-error:not([hidden])").waitFor();
      await settle(page);
    },
  },
  { name: "error-leaderboard", path: "/msbl-elo1v1", failApi: true, fullPage: true },
  { name: "error-players", path: "/players", failApi: true, fullPage: true },
  { name: "error-clubs", path: "/msbl-striker-clubs", failApi: true, fullPage: true },
  { name: "error-home", path: "/", failApi: true, fullPage: true },
  { name: "error-events", path: "/community-tournaments", failApi: true, fullPage: true },
  { name: "error-wiimmfi", path: "/msc-wiimmfi", failApi: true, fullPage: true },
  {
    name: "error-profile-popup",
    path: "/players",
    act: async (page) => {
      await page.route("**/api/players/*/profile", (route) =>
        route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Simulated failure."}' }),
      );
      await clickAndSettle(page, ".players-name-trigger[data-player-id]");
    },
  },
  {
    name: "gear-builder-first-pane",
    path: "/msbl-gear-builder",
    fullPage: true,
    act: (page) => openGearBuilderPane(page, "first"),
  },
  {
    name: "gear-builder-last-pane",
    path: "/msbl-gear-builder",
    fullPage: true,
    act: (page) => openGearBuilderPane(page, "last"),
  },
  { name: "placeholder-construction", path: "/tab-placeholder?state=construction", fullPage: true },
  { name: "placeholder-tba", path: "/tab-placeholder?state=tba", fullPage: true },
  {
    name: "nav-hover",
    path: "/competitive-rules",
    widths: [1280],
    act: async (page) => {
      await page.locator(".nav-top-link").nth(2).hover();
      await settle(page);
    },
  },
];

for (const state of STATES) {
  for (const width of state.widths ?? STATE_WIDTHS) {
    test(`${state.name} @${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await preparePage(page, { failApi: state.failApi });
      if (state.route) await state.route(page);
      if (state.login) await login(page, state.login);
      await page.goto(state.path);
      await settle(page, { eagerImages: true });
      if (state.act) await state.act(page);
      await hideDevNotice(page);
      if (state.fullPage) await expandViewportToDocument(page, width);
      await expectScreenshot(page, "states", `${state.name}-${width}.png`);
    });
  }
}
