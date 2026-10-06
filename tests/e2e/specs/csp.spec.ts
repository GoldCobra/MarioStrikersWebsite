import { expect, test, type Page } from "@playwright/test";
import { advance, hideDevNotice, login, preparePage, settle } from "../lib/browser.ts";
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

/** A paste into the focused field, as the browser delivers it. */
async function paste(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData("text", value);
    document.activeElement?.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, text);
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
  // The hidden admin page (docs/adr/0011): only the admin's menu offers it, built with the menu (never
  // added later); everyone else gets the ordinary not-found page at its address.
  "admin menu entry and admin page": async (page) => {
    await watchViolations(page);
    await preparePage(page);
    const notFound = await page.request.get("/does-not-exist");
    const missing = await notFound.text();
    const adminPage = "/_/fixture-admin-page-0000000/";

    await login(page, "linked");
    await page.goto("/");
    await settle(page, { eagerImages: true });
    await page.locator("button.nav-top-login.is-signed-in").click();
    await expect(page.locator(".global-account-menu-item")).toHaveText(["My Profile", "Logout"]);
    const refused = await page.request.get(adminPage);
    expect(refused.status()).toBe(404);
    expect(await refused.text()).toBe(missing);

    await page.context().clearCookies();
    await login(page, "admin");
    await page.goto("/");
    await settle(page, { eagerImages: true });
    // The entry is in the menu before it is ever opened.
    await expect(page.locator(".global-account-menu-item")).toHaveText(["My Profile", "Admin", "Logout"]);
    await page.locator("button.nav-top-login.is-signed-in").click();
    await page.locator(".global-account-menu-item", { hasText: "Admin" }).click();
    await page.waitForURL(`**${adminPage}`);
    await settle(page, { eagerImages: true });
    await expect(page.locator("#admin-root")).toHaveAttribute("aria-busy", "false");
    await expect(page.locator("#admin-root h2")).toHaveText("Admin");
    await expect(page.locator("#admin-root")).toContainText("Signed in as Sample Admin (sample_admin).");
    await expect(page.locator("#admin-root")).toContainText("page.open · allowed");
    await expect(page.locator("head meta[name='robots']")).toHaveAttribute("content", "noindex, nofollow");
    await expect(page.locator("head link[rel='canonical']")).toHaveCount(0);
  },
  // Editing in the browser: digits only, whole codes pasted with their leading zeros, the country picked
  // by typing, a new MSC code; every change waits in the draft and SAVE sends them all in one request
  // (once, also on a double click). The save is answered here, so the shared fixture stack keeps its data.
  "profile editor": async (page) => {
    await watchViolations(page);
    await preparePage(page);
    await login(page, "linked");
    await page.goto("/profile");
    await settle(page, { eagerImages: true });
    // The local notice sits where the save bar floats.
    await hideDevNotice(page);
    const save = page.locator("[data-edit-action='save']");
    const discard = page.locator("[data-edit-action='discard']");
    await expect(save).toBeDisabled();
    await expect(discard).toBeDisabled();

    await page.locator("[data-edit-open='switch']").click();
    const fields = page.locator("[data-field-row='switch'] .profile-edit-digits");
    const error = page.locator("[data-field-row='switch'] .profile-edit-error");
    await fields.first().fill("");
    await fields.first().pressSequentially("1a2b");
    await expect(fields.first()).toHaveValue("12");
    await fields.nth(1).focus();
    await paste(page, "SW-0001-0020-0300");
    for (const [index, value] of ["0001", "0020", "0300"].entries()) await expect(fields.nth(index)).toHaveValue(value);
    await paste(page, "12ab");
    await expect(error).toHaveText("Paste a 12-digit friend code (digits only).");
    await expect(fields.first()).toHaveValue("0001");
    await expect(page.locator("[data-field-row='switch']")).toHaveClass(/is-unsaved/);
    await expect(save).toBeEnabled();

    // The country: a combobox with flags; typing jumps to the country, Enter takes it.
    await page.locator("[data-edit-open='country']").click();
    const combobox = page.locator("[role='combobox']");
    await expect(combobox).toBeFocused();
    await combobox.press("ArrowDown");
    await expect(combobox).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.type("united s");
    await expect(page.locator("[role='option'].is-active")).toHaveText("United States");
    await page.keyboard.press("Enter");
    await expect(combobox).toHaveAttribute("aria-expanded", "false");
    await expect(combobox).toContainText("United States");
    await expect(page.locator(".player-popup-flag")).toHaveAttribute("src", /flags\/us\.png$/);

    // The title: one of the member's titles, picked from a list that shows each in its look, after the
    // ball of its game.
    await page.locator("[data-edit-open='title']").click();
    await page.locator("#profile-title-select").click();
    await page.locator("[role='option'][data-value='msl-2025-world-champion-msbl']").click();
    await expect(page.locator("#profile-title-select .dropdown-text")).toHaveText("MSL 2025 WORLD CHAMPION");
    await expect(page.locator("#profile-title-select .dropdown-text")).toHaveClass(/is-look-msl-world/);
    await expect(page.locator("#profile-title-select .player-title-ball")).toHaveAttribute("alt", "MSBL");
    await expect(page.locator("[data-field-row='title']")).toHaveClass(/is-unsaved/);

    await page.locator("[data-edit-action='add']").click();
    const added = page.locator("[data-edit-row].is-msc").last();
    await added.locator("[data-field='region']").selectOption("PAL");
    await added.locator("[data-field='platform']").selectOption("Dolphin");
    await added.locator(".profile-edit-digits").first().focus();
    await paste(page, "0000-1111-2222");

    let saves = 0;
    await page.route("**/api/profile/me/editable", async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }
      saves += 1;
      const sent = route.request().postDataJSON() as {
        title?: string;
        country?: string;
        switch_code?: string;
        msc_codes?: { region: string; platform: string; code: string }[];
      };
      expect(sent.title).toBe("msl-2025-world-champion-msbl");
      expect(sent.country).toBe("us");
      expect(sent.switch_code).toBe("0001-0020-0300");
      expect(sent.msc_codes?.at(-1)).toEqual({ region: "PAL", platform: "Dolphin", code: "0000-1111-2222" });
      const current = (await (await route.fetch({ method: "GET" })).json()) as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...current, ...sent, changed: true }),
      });
    });
    await save.dblclick();
    await expect(page.locator(".profile-toast")).toHaveText(/Changes saved\./);
    await expect(page.locator(".profile-toasts")).toHaveAttribute("aria-live", "polite");
    await expect(page.locator(".profile-toasts")).toHaveAttribute("role", "status");
    expect(saves).toBe(1);
    await expect(page.locator("[data-edit-row]")).toHaveCount(0);
    await expect(save).toBeDisabled();
    await settle(page);
  },
  // DISCARD asks first and then shows what is saved; leaving with unsaved changes warns.
  "profile editor discard": async (page) => {
    await watchViolations(page);
    await preparePage(page);
    await login(page, "linked");
    await page.goto("/profile");
    await settle(page, { eagerImages: true });
    await hideDevNotice(page);
    const value = page.locator("[data-field-row='switch'] .player-popup-code-value");
    const saved = await value.textContent();
    await page.locator("[data-edit-open='switch']").click();
    await page.locator("[data-field-row='switch'] .profile-edit-digits").first().fill("9999");
    const unload = (): Promise<boolean> =>
      page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      });
    expect(await unload()).toBe(true);
    await page.locator("[data-edit-action='discard']").click();
    await expect(page.locator(".profile-edit-bar-text")).toHaveText("Discard all unsaved changes?");
    await expect(page.locator("[data-edit-action='discard-confirm']")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-edit-action='discard']")).toBeVisible();
    // The click on DISCARD closed the field; the draft keeps the change.
    await expect(page.locator("[data-field-row='switch']")).toHaveClass(/is-unsaved/);
    await expect(value).toContainText("9999");
    await page.locator("[data-edit-action='discard']").click();
    await page.locator("[data-edit-action='discard-confirm']").click();
    await expect(page.locator(".profile-toast")).toHaveText(/Changes discarded\./);
    await expect(value).toHaveText(saved ?? "");
    await expect(page.locator("[data-edit-action='save']")).toBeDisabled();
    expect(await unload()).toBe(false);
    await settle(page);
  },
  // An older MSC code saved without a platform asks for one, and another change is saved while that code
  // stays as it is.
  "profile editor with a code without platform": async (page) => {
    await watchViolations(page);
    await preparePage(page);
    await login(page, "linked");
    const saved: { body?: { msc_codes?: { platform: string }[] } } = {};
    await page.route("**/api/profile/me/editable", async (route) => {
      const response = await route.fetch({ method: "GET" });
      const profile = (await response.json()) as { msc_codes: { platform: string }[] };
      profile.msc_codes = profile.msc_codes.map((entry, index) => (index === 0 ? { ...entry, platform: "" } : entry));
      if (route.request().method() === "PUT") {
        saved.body = route.request().postDataJSON() as { msc_codes?: { platform: string }[] };
        await route.fulfill({ response, json: { ...profile, ...saved.body, changed: true } });
        return;
      }
      await route.fulfill({ response, json: profile });
    });
    await page.goto("/profile");
    await settle(page, { eagerImages: true });
    await hideDevNotice(page);
    await expect(page.locator(".profile-row-hint")).toHaveText("Select the platform.");
    await page.locator("[data-edit-open='country']").click();
    await page.locator("[role='combobox']").click();
    await page.locator("[role='option']", { hasText: "United States" }).click();
    await page.locator("[data-edit-action='save']").click();
    await expect(page.locator(".profile-toast")).toHaveText(/Changes saved\./);
    expect(saved.body?.msc_codes?.[0]?.platform).toBe("");
    await settle(page);
  },
  // A click outside an open field closes it and keeps what was entered, unsaved; clicks into its lists do
  // not close it, a pencil elsewhere opens that field at once, and an empty code line added with "+" goes.
  // Nothing is sent. The title list holds only the member's titles, in the API's order, without groups, each
  // in its look after its game's ball; this page shows the title only in its field.
  "profile editor closes fields on a click outside": async (page) => {
    await watchViolations(page);
    await preparePage(page);
    await login(page, "linked");
    let puts = 0;
    page.on("request", (request) => {
      if (request.method() === "PUT" && request.url().includes("/api/profile/me/editable")) puts += 1;
    });
    await page.goto("/profile");
    await settle(page, { eagerImages: true });
    await hideDevNotice(page);
    const outside = page.locator("#profile-country-label");
    const open = page.locator("[data-edit-row]");
    const titleRow = page.locator("[data-field-row='title']");
    const titleList = page.locator("#profile-title-select");
    const titleOption = (code: string) => page.locator(`[role='option'][data-value='${code}']`);
    await expect(page.locator(".player-popup-player-title")).toHaveCount(0);

    await page.locator("[data-edit-open='title']").click();
    await titleList.click();
    const options = await page
      .locator("#profile-title-select-listbox [role='option']")
      .evaluateAll((nodes) =>
        nodes.map((node) => [
          (node as HTMLElement).dataset.value ?? "",
          (node as HTMLElement).innerText,
          /is-look-([a-z0-9-]+)/.exec(node.querySelector(".dropdown-text")?.className ?? "")?.[1] ?? "",
          node.querySelector(".player-title-ball")?.getAttribute("alt") ?? "",
        ]),
      );
    // MSL: X-TIME first, then WORLD before SPRING CHAMPION, whatever the year (owner, 2026-10-02).
    expect(options.slice(0, 10)).toEqual([
      ["", "No player title", "", ""],
      ["wfc-final-season-leader", "WFC FINAL SEASON LEADER", "special", ""],
      ["msl-2-time-world-champion-msbl", "2-TIME WORLD CHAMPION", "msl-world", "MSBL"],
      ["msl-2025-world-champion-msbl", "MSL 2025 WORLD CHAMPION", "msl-world", "MSBL"],
      ["msl-2026-spring-champion-sms", "MSL 2026 SPRING CHAMPION", "msl", "SMS"],
      ["season-titan-1-msbl", "BURST 2026 STRIKERS TITAN", "season", "MSBL"],
      ["tournament-winner-green-msc", "TOURNAMENT WINNER", "tournament-x5", "MSC"],
      ["tournament-winner-msc", "TOURNAMENT WINNER", "tournament", "MSC"],
      ["legacy-megastriker", "LEGACY MEGASTRIKER", "legacy", ""],
      ["three-ghosts", "3 GHOSTS", "free", ""],
    ]);
    await titleOption("tournament-winner-msc").click();
    await expect(open).toHaveCount(1);
    await outside.click();
    await expect(open).toHaveCount(0);
    await expect(titleRow).toHaveClass(/is-unsaved/);
    await expect(titleRow.locator(".player-popup-code-value")).toHaveText("TOURNAMENT WINNER");
    await expect(titleRow.locator(".player-popup-code-value")).toHaveClass(/is-look-tournament(?!-)/);
    await expect(titleRow.locator(".player-popup-code-value .player-title-ball")).toHaveAttribute("alt", "MSC");

    // The country list belongs to its field: picking from it keeps the field open.
    await page.locator("[data-edit-open='country']").click();
    await page.locator("[role='combobox']").click();
    await page.locator("[role='option']", { hasText: "United States" }).click();
    await expect(page.locator("[data-edit-row][data-field-row='country']")).toHaveCount(1);
    await page.mouse.click(4, 400);
    await expect(open).toHaveCount(0);
    await expect(page.locator("[data-field-row='country']")).toHaveClass(/is-unsaved/);
    await expect(page.locator("[data-field-row='country'] .player-popup-code-value")).toHaveText("United States");

    // One click on another pencil closes this field and opens that one.
    await page.locator("[data-edit-open='switch']").click();
    await page.locator("[data-field-row='switch'] .profile-edit-digits").first().fill("1234");
    await page.locator("[data-edit-open^='msc:']").first().click();
    await expect(open).toHaveCount(1);
    await expect(page.locator("[data-edit-row].is-msc")).toHaveCount(1);
    await expect(page.locator("[data-field-row='switch']")).toHaveClass(/is-unsaved/);
    await expect(page.locator("[data-field-row='switch'] .player-popup-code-value")).toContainText("1234");
    await outside.click();
    await expect(open).toHaveCount(0);

    // A code line added with "+" and left empty goes when it closes.
    const codes = page.locator("[data-field-row^='msc:']");
    const before = await codes.count();
    await page.locator("[data-edit-action='add']").click();
    await expect(codes).toHaveCount(before + 1);
    await outside.click();
    await expect(codes).toHaveCount(before);

    // "No player title": the field says so, muted.
    await page.locator("[data-edit-open='title']").click();
    await titleList.click();
    await titleOption("").click();
    await outside.click();
    await expect(titleRow.locator(".player-popup-code-value")).toHaveText("No player title");
    await expect(titleRow).toHaveClass(/profile-code-missing/);
    await expect(titleRow.locator(".player-title-ball")).toHaveCount(0);

    await expect(page.locator("[data-edit-action='save']")).toBeEnabled();
    expect(puts).toBe(0);
    await settle(page);
  },
  // The player title is the content's first line, before the friend codes, in its look and after its game's
  // ball; the header has none. Without a title the Switch code takes its place: no empty line, no extra gap.
  "player title in the popup and on the card": async (page) => {
    await open(page, "/players");
    const popup = page.locator("#player-profile-popup");
    const title = popup.locator(".player-popup-content > .player-popup-player-title");
    const topOf = (selector: string): Promise<number> =>
      popup.evaluate((root, css) => {
        const content = root.querySelector(".player-popup-content");
        const node = root.querySelector(css);
        return node && content ? node.getBoundingClientRect().top - content.getBoundingClientRect().top : NaN;
      }, selector);
    await page.locator('.players-name-trigger[data-player-id="2"]').click();
    await settle(page, { eagerImages: true });
    await expect(title).toHaveText("SELF-PROCLAIMED KING OF STRIKERS");
    await expect(title).toHaveClass(/is-look-free/);
    await expect(title.locator(".player-title-ball")).toHaveCount(0);
    await expect(popup.locator(".player-popup-header .player-popup-player-title")).toHaveCount(0);
    const titledTop = await topOf(".player-popup-player-title");
    await page.keyboard.press("Escape");
    await page.locator('.players-name-trigger[data-player-id="4"]').click();
    await settle(page, { eagerImages: true });
    await expect(title).toBeHidden();
    expect(await topOf(".player-popup-section")).toBeCloseTo(titledTop, 1);

    await page.goto("/player-card?player=3");
    await page.locator("html[data-player-card='ready']").waitFor();
    await expect(title).toBeHidden();
    await page.goto("/player-card?player=5");
    await page.locator("html[data-player-card='ready']").waitFor();
    await expect(title).toHaveText("LEGACY SUPERSTAR");
    await expect(title).toHaveClass(/is-look-legacy/);
    await expect(title.locator(".player-title-ball")).toHaveCount(0);

    // A title of a game: its ball, loaded before the card reports "ready", on the same line and no taller.
    await page.route("**/api/players/5/profile", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { player?: Record<string, unknown> };
      const player = {
        ...body.player,
        title: "TOURNAMENT WINNER",
        title_style: "tournament-x5",
        title_game_code: "MSC",
      };
      await route.fulfill({ response, json: { ...body, player } });
    });
    const plainHeight = await title.evaluate((node) => node.getBoundingClientRect().height);
    await page.goto("/player-card?player=5");
    await page.locator("html[data-player-card='ready']").waitFor();
    const ball = title.locator(".player-title-ball");
    await expect(ball).toHaveAttribute("alt", "MSC");
    await expect(ball).toHaveAttribute("src", /mscball\.webp$/);
    expect(
      await ball.evaluate((node) => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0),
    ).toBe(true);
    await expect(title).toHaveClass(/is-look-tournament-x5/);
    expect(await title.evaluate((node) => node.getBoundingClientRect().height)).toBeCloseTo(plainHeight, 1);
    await settle(page);
  },
  // Every dropdown (lib/dropdown.ts) opens over the page: no container cuts it off and nothing covers it. It
  // opens above a field low in the window, is never taller than the room it has, scrolls, and every option
  // can be reached and taken. Its field and options are in the type of the line's value, the options compact.
  "dropdowns open over the page, fit the window and reach every option": async (page) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await watchViolations(page);
    await preparePage(page);
    await login(page, "linked");
    await page.goto("/profile");
    await settle(page, { eagerImages: true });
    await hideDevNotice(page);
    const field = page.locator("#profile-country-select");
    const list = page.locator("#profile-country-select-listbox");
    const options = list.locator("[role='option']");
    const countryValue = page.locator("[data-field-row='country'] .player-popup-code-value");
    const valueType = await countryValue.evaluate((node) => {
      const style = getComputedStyle(node);
      return [style.fontFamily, style.fontSize, style.fontWeight, style.letterSpacing].join(" | ");
    });
    /** Where the open list is, and whether it is the topmost thing at its corners and in its middle. */
    const placement = () =>
      page.evaluate(() => {
        const listNode = document.getElementById("profile-country-select-listbox") ?? document.body;
        const listBox = listNode.getBoundingClientRect();
        const fieldBox = document.getElementById("profile-country-select")?.getBoundingClientRect() ?? listBox;
        const points = [
          [listBox.left + 4, listBox.top + 4],
          [listBox.right - 4, listBox.bottom - 4],
          [listBox.left + listBox.width / 2, listBox.top + listBox.height / 2],
        ];
        return {
          topLayer: listNode.matches(":popover-open"),
          up: listBox.bottom <= fieldBox.top,
          inWindow: listBox.top >= 0 && listBox.bottom <= window.innerHeight,
          visible: points.every(([x, y]) => listNode.contains(document.elementFromPoint(x ?? 0, y ?? 0))),
          scrolls: listNode.scrollHeight > listNode.clientHeight,
          gap: listBox.top - fieldBox.bottom,
        };
      });

    // A field low in the window: the list opens above it, inside the window, on top of everything.
    await page.locator("[data-edit-open='country']").click();
    await field.evaluate((node) => {
      window.scrollBy(0, node.getBoundingClientRect().bottom - window.innerHeight + 40);
    });
    await field.click();
    await expect(list).toBeVisible();
    expect(await placement()).toMatchObject({ topLayer: true, up: true, inWindow: true, visible: true, scrolls: true });

    // Type: the field's value and every option in the value's type; options as compact as the tokens say.
    const typeOf = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((node) => {
          const style = getComputedStyle(node);
          return [style.fontFamily, style.fontSize, style.fontWeight, style.letterSpacing].join(" | ");
        });
    expect(await typeOf("#profile-country-select .dropdown-text")).toBe(valueType);
    expect(await typeOf("#profile-country-select-listbox .dropdown-text")).toBe(valueType);
    const heights = await options.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
    expect(Math.max(...heights)).toBeLessThanOrEqual(24.5);

    // The page scrolls: the list goes with its field.
    await page.evaluate(() => {
      window.scrollBy(0, -120);
    });
    await advance(page, 500);
    expect(await placement()).toMatchObject({ visible: true, inWindow: true });

    // The last option, scrolled to, is taken by a click; the field stays open until a click outside it.
    await list.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    const last = options.last();
    const lastName = (await last.innerText()).trim();
    await last.click();
    await expect(list).toBeHidden();
    await expect(field).toContainText(lastName);
    await expect(page.locator("[data-edit-row][data-field-row='country']")).toHaveCount(1);
    await page.mouse.click(4, 300);
    await expect(page.locator("[data-edit-row]")).toHaveCount(0);
    await expect(countryValue).toHaveText(lastName);

    // A short card (a profile created at login, here without its statistics, whose three areas always show):
    // the list reaches out of the card, whole and on top.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.context().clearCookies();
    await login(page, "unlinked");
    await page.route("**/api/profile/me/stats", (route) =>
      route.fulfill({ status: 503, json: { error: "Unavailable.", code: "UNAVAILABLE" } }),
    );
    await page.goto("/profile");
    await settle(page, { eagerImages: true });
    await hideDevNotice(page);
    await page.locator("[data-edit-open='country']").click();
    await field.click();
    const card = await page.locator("#player-profile-page .popup-card").boundingBox();
    const listBox = await list.boundingBox();
    expect(listBox && card && listBox.y + listBox.height > card.y + card.height).toBe(true);
    expect(await placement()).toMatchObject({ topLayer: true, up: false, inWindow: true, visible: true });
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await settle(page);
  },
  // A player title looks the same wherever it is shown: the popup's line, the Discord card's line, the
  // profile's field, and the title dropdown's field and options (one definition, .player-title). The Tourney
  // Accolades and Season Rewards take its type, and a won MSL World Championship its gold, 1:1.
  "player titles look the same in every view": async (page) => {
    const look = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((node) => {
          const style = getComputedStyle(node);
          return {
            font: [style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight].join(" | "),
            spacing: style.letterSpacing,
            caps: style.textTransform,
            color: style.color,
            glow: style.textShadow,
            text: (node as HTMLElement).innerText.trim(),
            ball: node.querySelector(".player-title-ball")?.getAttribute("alt") ?? "",
          };
        });
    // Set after preparePage: a later route is matched before its catch-all one.
    await watchViolations(page);
    await preparePage(page);
    await page.route("**/api/players/2/profile", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { player?: Record<string, unknown> };
      const player = {
        ...body.player,
        title: "MSL 2025 WORLD CHAMPION",
        title_style: "msl-world",
        title_game_code: "MSBL",
      };
      await route.fulfill({ response, json: { ...body, player } });
    });
    await page.goto("/players");
    await settle(page, { eagerImages: true });
    await page.locator('.players-name-trigger[data-player-id="2"]').click();
    await settle(page, { eagerImages: true });
    const popup = await look("#player-profile-popup .player-popup-player-title");
    expect(popup).toMatchObject({ spacing: "0.6px", caps: "uppercase", text: "MSL 2025 WORLD CHAMPION", ball: "MSBL" });
    expect(popup.glow).not.toBe("none");
    const typeOf = ({ font, spacing, caps }: { font: string; spacing: string; caps: string }) => ({
      font,
      spacing,
      caps,
    });
    await page.locator("#player-profile-popup .player-popup-accolades-details > summary").click();
    const champion = await look("#player-profile-popup .player-popup-accolade-name.is-world-champion");
    expect({ ...champion, text: "", ball: "" }).toEqual({ ...popup, text: "", ball: "" });
    expect(typeOf(await look("#player-profile-popup .player-popup-accolade-date"))).toEqual(typeOf(popup));

    await page.goto("/player-card?player=2");
    await page.locator("html[data-player-card='ready']").waitFor();
    expect(await look(".player-popup-player-title")).toEqual(popup);

    await login(page, "linked");
    await page.goto("/profile");
    await settle(page, { eagerImages: true });
    await hideDevNotice(page);
    await page.locator("#player-profile-page .player-popup-season-awards-details > summary").click();
    expect(typeOf(await look("#player-profile-page .player-popup-season-award-name"))).toEqual(typeOf(popup));
    expect(typeOf(await look("#player-profile-page .player-popup-season-award-season"))).toEqual(typeOf(popup));
    await page.locator("#player-profile-page .player-popup-season-awards-details > summary").click();
    await page.locator("#player-profile-page .player-popup-accolades-details > summary").click();
    const plainAccolade = "#player-profile-page .player-popup-accolade-name:not(.is-world-champion)";
    expect(await look(plainAccolade)).toMatchObject({ ...typeOf(popup), glow: "none" });
    expect(typeOf(await look("#player-profile-page .player-popup-accolade-date"))).toEqual(typeOf(popup));
    await page.locator("#player-profile-page .player-popup-accolades-details > summary").click();
    await page.locator("[data-edit-open='title']").click();
    await page.locator("#profile-title-select").click();
    const option = "[role='option'][data-value='msl-2025-world-champion-msbl'] .player-title";
    expect(await look(option)).toEqual(popup);
    await page.locator(option).click();
    expect(await look("#profile-title-select .player-title")).toEqual(popup);
    await page.mouse.click(4, 400);
    await expect(page.locator("[data-edit-row]")).toHaveCount(0);
    expect(await look("[data-field-row='title'] .player-title")).toEqual(popup);
    await settle(page);
  },
  // A field's value sits in the middle of its grey box (its capitals, trimmed by text-box), in every view and
  // in both modes of a profile line, and every heading is as far from its first box. An open line is as
  // tall as a closed one.
  "field values are centred in their boxes, headings evenly spaced": async (page) => {
    const offsets = (selector: string) =>
      page.locator(selector).evaluateAll((nodes) =>
        nodes
          .filter((node) => (node as HTMLElement).offsetParent)
          .map((node) => {
            const box = node.getBoundingClientRect();
            const row = (node.closest(".player-popup-code-row, .profile-edit-row") ?? node).getBoundingClientRect();
            return Math.round(Math.abs(box.top + box.height / 2 - (row.top + row.height / 2)) * 100) / 100;
          }),
      );
    const headingGaps = () =>
      page.locator(".player-popup-code-list").evaluateAll((lists) =>
        lists
          .filter((list) => (list as HTMLElement).offsetParent && list.firstElementChild)
          .map((list) => {
            const heading = list.parentElement?.querySelector(".player-popup-section-title");
            const first = list.firstElementChild?.getBoundingClientRect();
            return heading && first
              ? Math.round((first.top - heading.getBoundingClientRect().bottom) * 100) / 100
              : NaN;
          }),
      );
    await open(page, "/player-card?player=2");
    await page.locator("html[data-player-card='ready']").waitFor();
    for (const offset of await offsets(".player-popup-code-value, .player-popup-code-prefix"))
      expect(offset).toBeLessThanOrEqual(0.5);
    const cardGaps = await headingGaps();
    expect(new Set(cardGaps).size).toBe(1);

    await login(page, "linked");
    await page.goto("/profile");
    await settle(page, { eagerImages: true });
    await hideDevNotice(page);
    for (const offset of await offsets(".player-popup-code-value, .player-popup-code-prefix"))
      expect(offset).toBeLessThanOrEqual(0.5);
    expect(await headingGaps()).toEqual((await headingGaps()).map(() => cardGaps[0]));
    const closedHeight = await page
      .locator("[data-field-row='title']")
      .evaluate((node) => node.getBoundingClientRect().height);
    for (const field of ["title", "country"]) {
      await page.locator(`[data-edit-open='${field}']`).click();
      const row = page.locator(`[data-edit-row][data-field-row='${field}']`);
      expect(await row.evaluate((node) => node.getBoundingClientRect().height)).toBeCloseTo(closedHeight, 1);
      for (const offset of await offsets(`[data-edit-row][data-field-row='${field}'] .dropdown-field .dropdown-text`))
        expect(offset).toBeLessThanOrEqual(0.5);
    }
    await page.locator("[data-edit-open='switch']").click();
    expect(
      await page
        .locator("[data-edit-row][data-field-row='switch']")
        .evaluate((node) => node.getBoundingClientRect().height),
    ).toBeCloseTo(closedHeight, 1);
    await settle(page);
  },
  // The Discord card is an image of one size, made in whatever window the bot opens: it looks the same in all.
  // MY PROFILE's statistics (owner, 2026-10-03): only on the member's own /profile, in the place of the rating
  // cards and before Season Rewards and Tourney Accolades; read from the session only (no id is taken). The
  // player popup and the Discord card keep their rating cards and never ask for the statistics.
  "my profile statistics replace the rating cards only there": async (page) => {
    await watchViolations(page);
    await preparePage(page);
    const anonymous = await page.request.get("/api/profile/me/stats");
    expect(anonymous.status()).toBe(401);
    await login(page, "linked");
    const own: unknown = await (await page.request.get("/api/profile/me/stats")).json();
    for (const forged of ["?player_id=2", "?playerId=3&discord_id=900000000000000002"]) {
      expect(await (await page.request.get(`/api/profile/me/stats${forged}`)).json()).toEqual(own);
    }
    await page.goto("/profile");
    await settle(page, { eagerImages: true });
    await hideDevNotice(page);
    const profile = page.locator("#player-profile-page");
    await expect(profile.locator(".player-popup-rating-card, [data-slot^='ratings-grid']")).toHaveCount(0);
    const areas = profile.locator(".profile-stats-game");
    await expect(areas).toHaveCount(3);
    expect(await areas.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.statsGame))).toEqual([
      "msbl",
      "msc",
      "sms",
    ]);
    const fields = [
      "Season Rank",
      "Season ELO",
      "Season W/L",
      "Highest Season Rank",
      "Current WHR",
      "Highest WHR",
      "Total W/L",
      "Total Matches",
      "Total Win %",
      "Highest Legacy Rank",
    ];
    const read = (game: string) =>
      profile.locator(`[data-stats-game='${game}'] .profile-stat-row`).evaluateAll(
        (rows, ball) =>
          rows.map((row) => {
            const box = row.querySelector(".profile-stat-value")?.getBoundingClientRect();
            const value = row.querySelector(".player-popup-code-value")?.getBoundingClientRect();
            const image = row.querySelector<HTMLImageElement>(".profile-stat-ball");
            return {
              label: row.querySelector(".profile-stat-name")?.textContent ?? "",
              value: row.querySelector(".player-popup-code-value")?.textContent ?? "",
              ball: Boolean(image?.complete && image.naturalWidth > 0 && image.currentSrc.includes(`${ball}ball`)),
              // Right-aligned in the box (its padding), centred on its height.
              right: box && value ? Math.round(box.right - value.right) : NaN,
              middle: box && value ? Math.abs(box.top + box.height / 2 - (value.top + value.height / 2)) : NaN,
              height: box?.height ?? NaN,
            };
          }),
        game,
      );
    const rows = { msbl: await read("msbl"), msc: await read("msc"), sms: await read("sms") };
    for (const [game, list] of Object.entries(rows)) {
      expect(
        list.map((row) => row.label),
        game,
      ).toEqual(fields);
      for (const row of list) {
        expect(row.ball, `${game} ${row.label}`).toBe(true);
        expect(row.middle, `${game} ${row.label}`).toBeLessThanOrEqual(0.5);
        expect(row.height).toBe(list[0]?.height);
        expect(row.right).toBe(rows.msbl[0]?.right);
      }
    }
    expect(rows.msbl.map((row) => row.value)).toEqual([
      "Gold III",
      "1187",
      "14-6",
      "Platinum II",
      "1612",
      "1688",
      "212-131",
      "343",
      "61.8%",
      "Megastriker",
    ]);
    expect(rows.msc.slice(0, 4).map((row) => row.value)).toEqual(["-", "-", "-", "Gold I"]);
    // Rated before, nothing played in this season yet: a real 0-0 (owner, 2026-10-03: zeros only once rated).
    expect(rows.sms.map((row) => row.value)).toEqual([
      "Unranked",
      "500",
      "0-0",
      "Bronze III",
      "1043",
      "1101",
      "9-12",
      "21",
      "42.9%",
      "-",
    ]);
    // The statistics come before Season Rewards and Tourney Accolades, which keep working.
    const order = await profile.evaluate((root) => {
      const stats = root.querySelector(".profile-stats");
      const rewards = root.querySelector(".player-popup-season-awards-details");
      const accolades = root.querySelector(".player-popup-accolades-details");
      const follows = (a: Element | null, b: Element | null) =>
        Boolean(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return follows(stats, rewards) && follows(rewards, accolades);
    });
    expect(order).toBe(true);
    // The mouse wheel over the profile scrolls the page; only the popup keeps it to itself (owner, 2026-10-03).
    const viewport = page.viewportSize();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    const statsBox = await profile.locator(".profile-stats").boundingBox();
    if (!statsBox) throw new Error("The statistics are not on the page.");
    await page.mouse.move(statsBox.x + statsBox.width / 2, Math.min(statsBox.y + 40, 680));
    await page.mouse.wheel(0, 300);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    if (viewport) await page.setViewportSize(viewport);
    await profile.locator(".player-popup-accolades-details > summary").click();
    await expect(profile.locator(".player-popup-accolade-item").first()).toBeVisible();

    // Elsewhere nothing changes: the popup and the card keep their rating cards and never ask.
    let asked = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/profile/me/stats")) asked += 1;
    });
    await page.goto("/players");
    await settle(page, { eagerImages: true });
    await page.locator('.players-name-trigger[data-player-id="1"]').click();
    await settle(page, { eagerImages: true });
    expect(await page.locator("#player-profile-popup .player-popup-rating-card").count()).toBeGreaterThan(0);
    await expect(page.locator("#player-profile-popup .profile-stats")).toHaveCount(0);
    await page.goto("/player-card?player=1");
    await page.locator("html[data-player-card='ready']").waitFor();
    expect(await page.locator(".player-popup-rating-card").count()).toBeGreaterThan(0);
    await expect(page.locator(".profile-stats")).toHaveCount(0);
    expect(asked).toBe(0);
    await settle(page);
  },
  "the Discord card looks the same in any window": async (page) => {
    await open(page, "/player-card?player=2");
    const shots: Buffer[] = [];
    for (const width of [550, 800, 1024, 1440]) {
      await page.setViewportSize({ width, height: 700 });
      await page.goto("/player-card?player=2");
      await page.locator("html[data-player-card='ready']").waitFor();
      await settle(page, { eagerImages: true });
      shots.push(await page.locator(".player-popup-card").screenshot());
    }
    const [first, ...others] = shots;
    for (const shot of others) expect(first && shot.equals(first)).toBe(true);
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
    // The snapshot's onchange attributes, turned into listeners too: ticking a character names it.
    await page.locator("#two").evaluate((box) => {
      (box as HTMLInputElement).checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(page.locator("#mySelectLabel option").first()).toHaveText("Luigi");
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
