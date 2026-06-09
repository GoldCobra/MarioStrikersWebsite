const { config } = require("./config");
const { createApp } = require("./server");
const { closePool, startKeepalive, stopKeepalive } = require("./db");
const { publicDataCache } = require("./services/public-data-cache");
const { communityEventsCache } = require("./services/events-service");

const app = createApp();

const server = app.listen(config.port, function () {
  console.log(`[api] Mario Strikers leaderboard API listening on :${config.port}`);
  startKeepalive();
  publicDataCache.start();
  communityEventsCache.start();
});

async function shutdown(signal) {
  console.log(`[api] Received ${signal}. Shutting down...`);
  server.close(async function () {
    await publicDataCache.stop();
    await communityEventsCache.stop();
    stopKeepalive();
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
