const { config } = require("./config");
const { createApp } = require("./server");
const { closePool, healthCheck } = require("./db");

const app = createApp();

const server = app.listen(config.port, async function () {
  console.log(`[api] Listening on :${config.port}`);
  console.log(`[api] MSSQL host: ${config.mssqlHost}:${config.mssqlPort} db: ${config.mssqlDatabase}`);
  try {
    await healthCheck();
    console.log("[api] MSSQL connection OK");
  } catch (error) {
    console.error("[api] MSSQL connection FAILED:", error.message);
  }
});

async function shutdown(signal) {
  console.log(`[api] Received ${signal}. Shutting down...`);
  server.close(async function () {
    await closePool();
    process.exit(0);
  });
}

process.on("SIGINT", function () { shutdown("SIGINT"); });
process.on("SIGTERM", function () { shutdown("SIGTERM"); });

process.on("unhandledRejection", function (reason) {
  console.error("[api] Unhandled rejection:", reason);
});

process.on("uncaughtException", function (error) {
  console.error("[api] Uncaught exception:", error);
  process.exit(1);
});
