// Local API with invented data: no credentials are read and no outside service is contacted.
// The site (npm run dev at the repository root) runs on 8787 and reaches this API through /api.

import { loadConfig } from "./config.ts";
import { createFixtureDataSource } from "./fixtures/data-source.ts";
import { blockExternalConnections, clearServiceEnvironment } from "./lib/local-isolation.ts";
import { createLogger, startServer } from "./server.ts";

const DEV_HOSTS = new Set(["127.0.0.1", "::1", "0.0.0.0"]);

if (process.env.NODE_ENV === "production") throw new Error("Fixture development mode cannot run in production.");
clearServiceEnvironment();
process.env.NODE_ENV = "development";
process.env.MSC_DEV_FIXTURES = "1";
blockExternalConnections();

const host = process.env.DEV_HOST ?? "127.0.0.1";
if (!DEV_HOSTS.has(host)) throw new Error("Invalid DEV_HOST.");
const port = process.env.PORT === undefined ? 8788 : Number(process.env.PORT);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid PORT.");

const config = loadConfig({ ...process.env, PORT: String(port) }, { isolated: true });
const log = createLogger(config);
try {
  const started = await startServer({
    config,
    host,
    log,
    data: createFixtureDataSource({ fixedNow: process.env.MSC_FIXTURE_NOW }),
  });
  // Launchers and tests read the port from this line.
  console.log(`[dev] API with synthetic sample data on port ${started.port}; Discord login is simulated.`);
} catch (error) {
  const code = (error as { code?: string }).code;
  console.error(
    code === "EADDRINUSE"
      ? `[dev] Port ${port} is already in use. Stop your other server or choose PORT.`
      : `[dev] ${String(error)}`,
  );
  process.exit(1);
}
