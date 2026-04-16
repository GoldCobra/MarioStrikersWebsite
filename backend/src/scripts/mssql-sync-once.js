const { getLeaderboardRows } = require("../services/leaderboards-service");
const { closePool } = require("../db");

async function main() {
  try {
    const rows = await getLeaderboardRows({
      gameCode: "msbl",
      modeCode: "elo1v1",
      limit: 10,
      offset: 0
    });

    console.log(JSON.stringify({
      status: "ok",
      game: "msbl",
      mode: "elo1v1",
      count: rows.length,
      sample: rows.slice(0, 3)
    }, null, 2));
  } catch (error) {
    console.error(`[mssql:test] failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main();
