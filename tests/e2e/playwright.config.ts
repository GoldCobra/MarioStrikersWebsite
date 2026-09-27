import { defineConfig } from "@playwright/test";

// Projects are selected by run.ts; see its header for the workflow.
const visualSnapshots = "{testDir}/../.cache/visual/{arg}{ext}";
const goldenSnapshots = "{testDir}/../golden/{arg}{ext}";

export default defineConfig({
  testDir: "./specs",
  outputDir: "./.cache/test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 120_000,
  reporter: process.env.CI ? [["list"], ["html", { outputFolder: "./.cache/report", open: "never" }]] : [["list"]],
  expect: {
    timeout: 30_000,
    // threshold 0.01 ignores colour deltas of at most 2/255 (software raster noise between runs);
    // any larger change or any moved pixel fails.
    toHaveScreenshot: { maxDiffPixels: 0, threshold: 0.01, animations: "disabled", caret: "hide", scale: "css" },
  },
  use: {
    timezoneId: "UTC",
    locale: "en-US",
    colorScheme: "light",
    deviceScaleFactor: 1,
    serviceWorkers: "block",
    launchOptions: {
      // Software rasterization on one thread keeps anti-aliasing identical between runs.
      args: [
        "--force-color-profile=srgb",
        "--font-render-hinting=none",
        "--disable-gpu",
        "--disable-partial-raster",
        "--disable-skia-runtime-opts",
        "--num-raster-threads=1",
      ],
    },
  },
  projects: [
    {
      name: "reference",
      testMatch: /visual-.*\.spec\.ts/,
      snapshotPathTemplate: visualSnapshots,
      use: { browserName: "chromium", baseURL: process.env.REF_URL },
    },
    {
      name: "candidate",
      testMatch: /visual-.*\.spec\.ts/,
      snapshotPathTemplate: visualSnapshots,
      use: { browserName: "chromium", baseURL: process.env.CAND_URL },
    },
    {
      name: "golden",
      testMatch: /dom\.spec\.ts/,
      snapshotPathTemplate: goldenSnapshots,
      use: { browserName: "chromium", baseURL: process.env.CAND_URL },
    },
    {
      name: "contract",
      testMatch: /contract\.spec\.ts/,
      use: { browserName: "chromium" },
    },
    {
      name: "routes",
      testMatch: /routes\.spec\.ts/,
      snapshotPathTemplate: goldenSnapshots,
      use: { browserName: "chromium" },
    },
  ],
});
