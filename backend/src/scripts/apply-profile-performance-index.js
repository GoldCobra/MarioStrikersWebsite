const { withPool } = require("../db");

const INDEX_NAME = "IX_Tournament_ProfileAccolades_Date";

const SQL = [
  "IF NOT EXISTS (",
  "  SELECT 1",
  "  FROM sys.indexes",
  "  WHERE name = '" + INDEX_NAME + "'",
  "    AND object_id = OBJECT_ID('dbo.Tournament')",
  ")",
  "BEGIN",
  "  CREATE NONCLUSTERED INDEX " + INDEX_NAME,
  "  ON dbo.Tournament (TournamentStartDate DESC, ID ASC)",
  "  INCLUDE (Name, GameType, Winner, RunnerUp, Bronze);",
  "END;"
].join(" ");

async function main() {
  await withPool(async function (pool) {
    await pool.request().query(SQL);
  });
  console.log("[profile-performance-index] " + INDEX_NAME + " ensured.");
}

if (require.main === module) {
  main().catch(function (error) {
    console.error("[profile-performance-index] failed:", error);
    process.exitCode = 1;
  });
}

module.exports = {
  INDEX_NAME,
  SQL
};
