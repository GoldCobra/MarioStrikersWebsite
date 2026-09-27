// npm run ops:profile-index: creates the index that keeps player profile accolades fast, once.

import { runOperation } from "./run-operation.ts";

const INDEX_NAME = "IX_Tournament_ProfileAccolades_Date";

const SQL = [
  "IF NOT EXISTS (",
  "  SELECT 1",
  "  FROM sys.indexes",
  `  WHERE name = '${INDEX_NAME}'`,
  "    AND object_id = OBJECT_ID('dbo.Tournament')",
  ")",
  "BEGIN",
  `  CREATE NONCLUSTERED INDEX ${INDEX_NAME}`,
  "  ON dbo.Tournament (TournamentStartDate DESC, ID ASC)",
  "  INCLUDE (Name, GameType, Winner, RunnerUp, Bronze);",
  "END;",
].join(" ");

await runOperation("ops:profile-index", async ({ database }) => {
  await database.withPool((pool) => pool.request().query(SQL));
  return { status: "ok", index: INDEX_NAME };
});
