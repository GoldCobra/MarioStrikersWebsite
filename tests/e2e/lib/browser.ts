import type { Page } from "@playwright/test";
import { FIXTURE_NOW } from "./site.ts";

// Pages run on a virtual clock: timers, intervals and animation frames only fire when a check
// advances time, in fixed steps with network work drained in between. Every run therefore
// renders the same moment, including second-by-second countdowns.

const BLANK_DOCUMENT = '<!doctype html><title>blocked</title><body style="margin:0;background:#000"></body>';
const STEP_MS = 500;
const QUIET_MS = 100;
const inFlight = new WeakMap<Page, { count: number }>();

function isLocal(url: URL): boolean {
  return url.hostname === "127.0.0.1" || url.hostname === "localhost";
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

// Freezes the clock and keeps every request on the local stack, so both stacks render identically.
export async function preparePage(page: Page, options: { failApi?: boolean } = {}): Promise<void> {
  const tracker = { count: 0 };
  inFlight.set(page, tracker);
  page.on("request", () => {
    tracker.count += 1;
  });
  page.on("requestfinished", () => {
    tracker.count -= 1;
  });
  page.on("requestfailed", () => {
    tracker.count -= 1;
  });

  const now = Date.parse(FIXTURE_NOW);
  await page.clock.install({ time: new Date(now - 1000) });
  await page.clock.pauseAt(new Date(now));

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

// Waits (in real time) until no request has been in flight for QUIET_MS.
async function drainNetwork(page: Page): Promise<void> {
  const tracker = inFlight.get(page);
  if (!tracker) throw new Error("preparePage() must run before settle().");
  const deadline = Date.now() + 30_000;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    if (tracker.count > 0) quietSince = Date.now();
    else if (Date.now() - quietSince >= QUIET_MS) return;
    await sleep(25);
  }
  throw new Error("Network did not become idle within 30 s.");
}

// Moves the page clock forward in fixed steps, letting triggered requests finish between steps.
export async function advance(page: Page, totalMs: number): Promise<void> {
  await drainNetwork(page);
  for (let elapsed = 0; elapsed < totalMs; elapsed += STEP_MS) {
    await page.clock.runFor(STEP_MS);
    await drainNetwork(page);
  }
}

async function waitInPage(page: Page, predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await page.evaluate(predicate)) return;
    await advance(page, STEP_MS);
  }
  throw new Error("Timed out waiting for " + what + ".");
}

// Waits until fonts, images, API calls and the account widget are finished.
export async function settle(page: Page, options: { eagerImages?: boolean } = {}): Promise<void> {
  await page.waitForLoadState("load");
  await advance(page, 1000);
  await waitInPage(
    page,
    () => {
      const account = document.querySelector("[data-auth-state]");
      return account?.getAttribute("data-auth-state") !== "loading";
    },
    "the account widget",
  );
  await page.evaluate(async (eager) => {
    await document.fonts.ready;
    const images = Array.from(document.images);
    if (eager) {
      for (const image of images) {
        if (image.loading === "lazy") image.loading = "eager";
      }
    }
    await Promise.all(
      images
        .filter((image) => eager || image.loading !== "lazy")
        .map((image) =>
          image.complete
            ? Promise.resolve()
            : new Promise<void>((done) => {
                image.addEventListener(
                  "load",
                  () => {
                    done();
                  },
                  { once: true },
                );
                image.addEventListener(
                  "error",
                  () => {
                    done();
                  },
                  { once: true },
                );
              }),
        ),
    );
  }, Boolean(options.eagerImages));
  // Tab strips measure themselves on resize; their first measurement can run before the web fonts
  // arrive. One resize pass after the fonts settles them.
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  // The embedded Gear Builder colours its sliders from window.onload, but it is injected after the
  // load event, so whether that runs depends on timing. Run it once so the final state is defined.
  await page.evaluate(() => {
    const fillColor = (window as unknown as { fillColor?: () => void }).fillColor;
    if (typeof fillColor === "function") fillColor();
  });
  await advance(page, 1000);
}

// Chromium leaves parts of very tall full-page captures unrastered, so full-length shots grow
// the viewport to the document height instead and capture that viewport.
export async function expandViewportToDocument(page: Page, width: number): Promise<void> {
  const height = await page.evaluate(() =>
    Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)),
  );
  await page.setViewportSize({ width, height: Math.min(Math.max(height, 900), 16_000) });
  await settle(page);
}

// The local development notice overlays content and is not part of the site design.
export async function hideDevNotice(page: Page): Promise<void> {
  await page.addStyleTag({ content: "#dev-data-notice{display:none!important}" });
}

// Simulated Discord login: "linked" has a player profile, "unlinked" does not, "admin" holds the fixture
// admin role (docs/adr/0011).
const LOGIN_CODES = { linked: "sample", unlinked: "sample-unlinked", admin: "sample-admin" } as const;

export async function login(page: Page, kind: keyof typeof LOGIN_CODES): Promise<void> {
  const start = await page.request.get("/api/auth/discord/start?returnTo=/", { maxRedirects: 0 });
  const location = start.headers().location;
  if (!location) throw new Error("Simulated login returned no redirect.");
  const callback = location.replace("code=sample&", `code=${LOGIN_CODES[kind]}&`);
  const response = await page.request.get(callback, { maxRedirects: 0 });
  if (response.status() !== 302) throw new Error(`Simulated login failed with HTTP ${response.status()}`);
}
