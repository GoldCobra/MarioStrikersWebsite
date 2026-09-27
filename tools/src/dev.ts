// `npm run dev`: the site with live reload (Astro, port 8787) plus the API with invented data (port 8788).
// `npm run dev:live`: the same site against the real services configured in apps/api/.env.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { REPO_ROOT, readPort, startProcess, stopOnExit, waitForHttp } from "./processes.ts";

const live = process.argv.includes("--live");
const port = readPort("PORT", 8787);
const apiPort = port + 1;
const apiOrigin = `http://127.0.0.1:${apiPort}`;

const api = startProcess(
  "api",
  process.execPath,
  ["--watch", live ? "src/dev-live.js" : "src/dev.js"],
  {
    PORT: String(apiPort),
    DEV_HOST: "127.0.0.1",
  },
  join(REPO_ROOT, "apps", "api"),
);
await waitForHttp(`${apiOrigin}/api/health`, api).catch((error: unknown) => {
  // Live mode may lack a database; the site still starts so pages and save tools stay usable.
  if (!live) throw error;
  console.warn(`[dev] API health check failed (${String(error)}); continuing.`);
});

// Resolve Astro's CLI through its package metadata, so the path survives package layout changes.
const astroPackage = createRequire(import.meta.url).resolve("astro/package.json");
const astroBin = (JSON.parse(readFileSync(astroPackage, "utf8")) as { bin: { astro: string } }).bin.astro;
const astroCli = join(dirname(astroPackage), astroBin);
const site = startProcess(
  "site",
  process.execPath,
  [astroCli, "dev", "--port", String(port), "--host", "127.0.0.1"],
  { MS_API_ORIGIN: apiOrigin },
  join(REPO_ROOT, "apps", "web"),
);
await waitForHttp(`http://127.0.0.1:${port}/`, site);
console.log(`[dev] ${live ? "Live services" : "Synthetic sample data"}: http://localhost:${port}`);
stopOnExit([api, site]);
