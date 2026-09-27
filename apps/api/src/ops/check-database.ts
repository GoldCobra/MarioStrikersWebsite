// npm run ops:check-db: reads the first MSBL 1v1 leaderboard rows to prove the database connection works.

import { getLeaderboardRows } from "../modules/leaderboards/service.ts";
import { runOperation } from "./run-operation.ts";

await runOperation("ops:check-db", async ({ config, database }) => {
  const limits = { defaultLimit: config.leaderboardDefaultLimit, maxLimit: config.leaderboardMaxLimit };
  const rows = await getLeaderboardRows(
    database,
    { gameCode: "msbl", modeCode: "elo1v1", limit: 10, offset: 0 },
    limits,
  );
  return { status: "ok", game: "msbl", mode: "elo1v1", count: rows.length, sample: rows.slice(0, 3) };
});
