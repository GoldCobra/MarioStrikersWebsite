// Production entry point: live MSSQL, Discord and FlareSolverr.

import path from "node:path";
import { loadConfig, loadEnvFile } from "./config.ts";
import { createLiveDataSource } from "./data-source.ts";
import { createLogger, startServer } from "./server.ts";

if (process.env.MSC_DEV_FIXTURES === "1") {
  throw new Error("Fixtures require npm run dev; npm start always uses live services.");
}
loadEnvFile(path.resolve(process.cwd(), ".env"));
const config = loadConfig(process.env);
const log = createLogger(config);
const { port } = await startServer({ config, host: config.host, log, data: createLiveDataSource(config, log) });
log.info(`[api] Mario Strikers API listening on :${port}`);
