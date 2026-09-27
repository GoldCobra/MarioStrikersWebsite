import type { Page } from "@playwright/test";
import { FIXTURE_NOW } from "./site.ts";

const BLANK_DOCUMENT = '<!doctype html><title>blocked</title><body style="margin:0;background:#000"></body>';

function isLocal(url: URL): boolean {
  return url.hostname === "127.0.0.1" || url.hostname === "localhost";
}

// Freezes the clock and keeps every request on the local stack, so both stacks render identically.
export async function preparePage(page: Page, options: { failApi?: boolean } = {}): Promise<void> {
  await page.clock.setFixedTime(new Date(FIXTURE_NOW));
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!isLocal(url)) {
      if (request.resourceType() === "document") {
        await route.fulfill({ status: 200, contentType: "text/html", body: BLANK_DOCUMENT });
        return;
      }
      await route.abort();
      return;
    }
    if (options.failApi && url.pathname.startsWith("/api/") && url.pathname !== "/api/auth/me") {
      await route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Simulated failure."}' });
      return;
    }
    await route.continue();
  });
}

// Waits until fonts, images, API calls and the account widget are finished.
export async function settle(page: Page, options: { eagerImages?: boolean } = {}): Promise<void> {
  await page.waitForLoadState("load");
  await page.waitForFunction(() => {
    const account = document.querySelector("[data-auth-state]");
    return !account || account.getAttribute("data-auth-state") !== "loading";
  });
  await page.waitForLoadState("networkidle");
  await page.evaluate(async (eager) => {
    await document.fonts.ready;
    const images = Array.from(document.images);
    if (eager) {
      for (const image of images) {
        if (image.loading === "lazy") image.loading = "eager";
      }
    }
    await Promise.all(images.filter((image) => eager || image.loading !== "lazy").map((image) => image.complete
      ? Promise.resolve()
      : new Promise<void>((done) => {
        image.addEventListener("load", () => done(), { once: true });
        image.addEventListener("error", () => done(), { once: true });
      })));
  }, Boolean(options.eagerImages));
  // Tab strips measure themselves on resize; their first measurement can run before the web fonts
  // arrive, so the final scroll position would depend on timing. One resize pass settles them.
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  // The embedded Gear Builder colours its sliders from window.onload, but it is injected after the
  // load event, so whether that runs depends on timing. Run it once so the final state is defined.
  await page.evaluate(() => {
    const fillColor = (window as unknown as { fillColor?: () => void }).fillColor;
    if (typeof fillColor === "function") fillColor();
  });
  await page.waitForTimeout(300);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

// Chromium leaves parts of very tall full-page captures unrastered, so full-length shots grow
// the viewport to the document height instead and capture that viewport.
export async function expandViewportToDocument(page: Page, width: number): Promise<void> {
  const height = await page.evaluate(() => Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)));
  await page.setViewportSize({ width, height: Math.min(Math.max(height, 900), 16_000) });
  await settle(page);
}

// The local development notice overlays content and is not part of the site design.
export async function hideDevNotice(page: Page): Promise<void> {
  await page.addStyleTag({ content: "#dev-data-notice{display:none!important}" });
}

// Simulated Discord login: "linked" has a player profile, "unlinked" does not.
export async function login(page: Page, kind: "linked" | "unlinked"): Promise<void> {
  const start = await page.request.get("/api/auth/discord/start?returnTo=/", { maxRedirects: 0 });
  const location = start.headers()["location"];
  if (!location) throw new Error("Simulated login returned no redirect.");
  const callback = kind === "unlinked" ? location.replace("code=sample&", "code=sample-unlinked&") : location;
  const response = await page.request.get(callback, { maxRedirects: 0 });
  if (response.status() !== 302) throw new Error("Simulated login failed with HTTP " + response.status());
}
