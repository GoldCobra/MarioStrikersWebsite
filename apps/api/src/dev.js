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
  const port = process.env.PORT === undefined ? 8787 : Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid PORT.");
  const host = process.env.DEV_HOST || "127.0.0.1";
  if (!["127.0.0.1", "::1", "0.0.0.0"].includes(host)) throw new Error("Invalid DEV_HOST.");
  const app = createApp({ providers: createFixtureProviders(), serveStatic: true });
  const server = app.listen(port, host, function () {
    console.log("[dev] Synthetic sample data; Discord login is simulated.");
    console.log("[dev] http://localhost:" + server.address().port);
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
