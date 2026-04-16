const { config } = require("./config");
const { createApp } = require("./server");
const { closePool } = require("./db");

const app = createApp();

const server = app.listen(config.port, function () {
  console.log(`[api] Mario Strikers leaderboard API listening on :${config.port}`);
});

async function shutdown(signal) {
  console.log(`[api] Received ${signal}. Shutting down...`);
  server.close(async function () {
    await closePool();
    process.exit(0);
  });
}

process.on("SIGINT", function () {
  shutdown("SIGINT");
});

process.on("SIGTERM", function () {
  shutdown("SIGTERM");
});
