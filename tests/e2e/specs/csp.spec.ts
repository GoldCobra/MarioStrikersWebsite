import { expect, test, type Page } from "@playwright/test";
import { hideDevNotice, login, preparePage, settle } from "../lib/browser.ts";
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

    // The title: one of the member's titles, picked from a list that shows each in its look.
    await page.locator("[data-edit-open='title']").click();
    await page.locator("#profile-title-select").click();
    await page.locator("[role='option'][data-value='msl-2025-world-champion']").click();
    await expect(page.locator("#profile-title-select .profile-country-name")).toHaveText("MSL 2025 WORLD CHAMPION");
    await expect(page.locator("#profile-title-select .profile-country-name")).toHaveClass(/is-look-msl-world/);
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
      expect(sent.title).toBe("msl-2025-world-champion");
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
  // in its look; this page shows the title only in its field.
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
          /is-look-([a-z0-9-]+)/.exec(node.querySelector(".profile-country-name")?.className ?? "")?.[1] ?? "",
        ]),
      );
    expect(options.slice(0, 10)).toEqual([
      ["", "No player title", ""],
      ["wfc-final-season-leader", "WFC FINAL SEASON LEADER", "special"],
      ["msl-2-time-world-champion", "2-TIME WORLD CHAMPION", "msl-world"],
      ["msl-2026-spring-champion", "MSL 2026 SPRING CHAMPION", "msl"],
      ["msl-2025-world-champion", "MSL 2025 WORLD CHAMPION", "msl-world"],
      ["season-titan-1", "BURST 2026 STRIKERS TITAN", "season"],
      ["tournament-winner-green", "TOURNAMENT WINNER", "tournament-x5"],
      ["tournament-winner", "TOURNAMENT WINNER", "tournament"],
      ["legacy-megastriker", "LEGACY MEGASTRIKER", "legacy"],
      ["three-ghosts", "3 GHOSTS", "free"],
    ]);
    await titleOption("tournament-winner").click();
    await expect(open).toHaveCount(1);
    await outside.click();
    await expect(open).toHaveCount(0);
    await expect(titleRow).toHaveClass(/is-unsaved/);
    await expect(titleRow.locator(".player-popup-code-value")).toHaveText("TOURNAMENT WINNER");
    await expect(titleRow.locator(".player-popup-code-value")).toHaveClass(/is-look-tournament(?!-)/);

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

    await expect(page.locator("[data-edit-action='save']")).toBeEnabled();
    expect(puts).toBe(0);
    await settle(page);
  },
  // The player title is the content's first line, before the friend codes, in its look; the header has
  // none. Without a title the Switch code takes its place: no empty line, no extra gap.
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
    await settle(page);
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
