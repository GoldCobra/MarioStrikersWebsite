// Renders the link preview image (og:image, 1200x630) from the site's own artwork: the landing page
// background, the logo and the site fonts. Run after changing any of them:
//   node tools/src/render-og-image.ts
// and commit apps/web/public/assets/og/mariostrikers-og.jpg.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { REPO_ROOT } from "./processes.ts";

const PUBLIC = join(REPO_ROOT, "apps/web/public");
const OUTPUT = join(PUBLIC, "assets/og/mariostrikers-og.jpg");
const asset = (path: string): string => pathToFileURL(join(PUBLIC, path)).href;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @font-face { font-family: "ITC Grizzly"; src: url("${asset("assets/fonts/itc-grizzly.woff")}"); }
  @font-face { font-family: "Reporter"; src: url("${asset("assets/fonts/MLSBY.woff")}"); font-weight: 700; }
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #000; }
  .scene {
    position: relative; width: 1200px; height: 630px; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 18px;
    background: linear-gradient(rgba(12, 2, 4, 0.55), rgba(12, 2, 4, 0.8)),
      url("${asset("assets/backgrounds/landing/landing-page-bg.png")}") center / cover;
  }
  .logo { height: 360px; filter: drop-shadow(0 10px 18px rgba(0, 0, 0, 0.75)); }
  .games {
    font-family: "ITC Grizzly", sans-serif; font-size: 40px; letter-spacing: 0.04em; color: #fff;
    text-shadow: -3px 3px 0 #000;
  }
  .games span { color: #ea9c4a; }
  .url { font-family: "Reporter", sans-serif; font-weight: 700; font-size: 26px; color: #f2d7b0; letter-spacing: 0.06em; }
</style></head>
<body><div class="scene">
  <img class="logo" src="${asset("assets/logo/logo.png")}" alt="">
  <div class="games">BATTLE LEAGUE <span>·</span> CHARGED <span>·</span> SUPER MARIO STRIKERS</div>
  <div class="url">MARIOSTRIKERS.GG</div>
</div></body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  // A file page may load the file:// artwork; about:blank (setContent) may not.
  const dir = mkdtempSync(join(tmpdir(), "og-image-"));
  writeFileSync(join(dir, "og.html"), html);
  await page.goto(pathToFileURL(join(dir, "og.html")).href, { waitUntil: "load" });
  rmSync(dir, { recursive: true, force: true });
  await page.evaluate("document.fonts.ready.then(() => true)");
  mkdirSync(join(PUBLIC, "assets/og"), { recursive: true });
  await page.screenshot({ path: OUTPUT, type: "jpeg", quality: 88 });
  console.log(`[og] ${OUTPUT}`);
} finally {
  await browser.close();
}
