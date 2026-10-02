// Local API against the real services configured in apps/api/.env. Coordinate with the owner first;
// use development credentials, never production ones.

import path from "node:path";
import { loadConfig, loadEnvFile } from "./config.ts";
import { createLiveDataSource } from "./data-source.ts";
import { createLogger, startServer } from "./server.ts";

if (process.env.NODE_ENV === "production") throw new Error("Use npm start for production.");
if (process.env.MSC_DEV_FIXTURES === "1") throw new Error("Remove MSC_DEV_FIXTURES before starting live development.");
process.env.NODE_ENV = "development";
loadEnvFile(path.resolve(process.cwd(), ".env"));

// A local server never awards player titles by itself; `npm run ops:title-sync` does on demand.
const config = loadConfig({ PORT: "8788", TITLE_SYNC_INTERVAL_MS: "0", ...process.env });
const log = createLogger(config);
const { port } = await startServer({
  config,
  host: process.env.DEV_HOST ?? "127.0.0.1",
  log,
  data: createLiveDataSource(config, log),
});
console.log(`[dev] API with live services on port ${port}.`);
