import { expect, request, test } from "@playwright/test";
import { PAGE_SLUGS, pagePath } from "../lib/site.ts";

// Status and Location of every public URL shape, compared with golden/routes.json.
// The golden was recorded against production nginx; CI replays it against the nginx container.
const ROUTES_URL = process.env.ROUTES_URL ?? "";

function buildProbes(): string[] {
  const probes = new Set<string>(["/", "/index.html", "/?utm_source=test", "/robots.txt", "/sitemap.xml"]);
  for (const slug of PAGE_SLUGS) {
    if (slug === "index") continue;
    for (const path of [pagePath(slug), `/${slug}/`, `/pages/${slug}.html`, `/pages/${slug}`, `/pages/${slug}/`,
      `/${slug}.html`, `/${slug.toUpperCase()}`, `/${slug}?ref=probe`]) {
      probes.add(path);
    }
  }
  for (const path of [
    "/pages/msbl", "/pages/msbl/", "/pages/msl-league-site.html", "/pages/msl-league-site", "/msl-league-site",
    "/msl-league-site/", "/games?submenu=msbl", "/games?submenu=msc", "/games?submenu=sms", "/games?submenu=unknown",
    "/games?tabs=none", "/competitive?submenu=rules", "/competitive?submenu=leaderboards",
    "/competitive?submenu=tier-lists", "/competitive?submenu=msl", "/competitive?submenu=tournaments",
    "/competitive?submenu=rules&x=1", "/msc?submenu=msbl", "/pages/players-msbl-clubs.html",
    "/pages/msbl-tier-lists.html", "/pages/msc-tier-lists.html", "/pages/sms-tier-lists.html", "/pages/unknown-page.html",
    "/does-not-exist", "/does-not-exist/", "/assets/", "/pages/", "/pages/templates/player-profile-popup.html",
    "/pages/templates/club-profile-popup.html", "/css/global.css", "/js/global-nav.js", "/favicon.ico",
    "/assets/logo/logo.webp", "/.env", "/backend/package.json", "/Dockerfile.backend"
  ]) {
    probes.add(path);
  }
  return [...probes];
}

test("routes match golden", async () => {
  test.skip(!ROUTES_URL, "ROUTES_URL is set by run.ts.");
  const context = await request.newContext({ baseURL: ROUTES_URL });
  const results: { path: string; status: number; location: string | null }[] = [];
  for (const path of buildProbes()) {
    const response = await context.get(path, { maxRedirects: 0 });
    results.push({ path, status: response.status(), location: response.headers()["location"] ?? null });
  }
  await context.dispose();
  expect(JSON.stringify(results, null, 2) + "\n").toMatchSnapshot("routes.json");
});
