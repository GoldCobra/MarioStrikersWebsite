const { clearServiceEnvironment, blockExternalConnections } = require("./lib/local-isolation");

function start() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Fixture development mode cannot run in production.");
  }
  clearServiceEnvironment();
  process.env.NODE_ENV = "development";
  process.env.MSC_DEV_FIXTURES = "1";
  blockExternalConnections();
  const { createApp } = require("./server");
  const { createFixtureProviders } = require("./dev/fixtures");
  // The site runs on 8787 (npm run dev at the repository root) and reaches this API through /api.
  const port = process.env.PORT === undefined ? 8788 : Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid PORT.");
  const host = process.env.DEV_HOST || "127.0.0.1";
  if (!["127.0.0.1", "::1", "0.0.0.0"].includes(host)) throw new Error("Invalid DEV_HOST.");
  const app = createApp({ providers: createFixtureProviders() });
  const server = app.listen(port, host, function () {
    console.log("[dev] API with synthetic sample data on port " + server.address().port + "; Discord login is simulated.");
  });
  server.on("error", function (error) {
    console.error(error.code === "EADDRINUSE"
      ? "[dev] Port " + port + " is already in use. Stop your other server or choose PORT."
      : "[dev] " + error.message);
    process.exitCode = 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, function () { server.close(); });
  }
  return server;
}

if (require.main === module) start();
module.exports = { start };
