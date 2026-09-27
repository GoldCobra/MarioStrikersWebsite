// Every SQL statement must stay byte-identical to what the API issued before the TypeScript rewrite.
// test-support/sql-golden.json was recorded from that version with the same scenarios and responses.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { silentLogger } from "./lib/logger.ts";
import { getMsblClubProfile, getMsblClubs } from "./modules/clubs/service.ts";
import { getLeaderboardRows } from "./modules/leaderboards/service.ts";
import { getPlayerProfile, getPlayerProfileByDiscordId, getPlayersList } from "./modules/players/service.ts";
import { getCompetitiveSeasonStatus } from "./modules/season/service.ts";
import { createFakeDatabase, type QueryHandler, type RecordedQuery } from "./test-support/fake-database.ts";

interface GoldenScenario {
  name: string;
  queries: { sql: string; inputs: Record<string, unknown>; types: Record<string, string | null>; multiple: boolean }[];
}

const golden = JSON.parse(
  readFileSync(new URL("./test-support/sql-golden.json", import.meta.url), "utf8"),
) as GoldenScenario[];

const EMPTY_PROFILE = [[{ player_id: 7, name: "Someone" }], [], [{}], [], [], [], [], [], []];
const LIMITS = { defaultLimit: 100, maxLimit: 500 };
const noLogos = null;
const noNames = { resolveRosterNames: <T>(rows: T[]): Promise<T[]> => Promise.resolve(rows) };
const whrLines = [{ line: "<:rookie:1>`Alpha 1500`" }, { line: "<:legend:1>`Beta 1600`" }];
const whrHandler: QueryHandler = (sql) =>
  sql.includes("GetRatingsForDiscord") ? { recordset: whrLines } : { recordset: [] };

function typeName(type: unknown): string | null {
  if (type === undefined) return null;
  if (typeof type === "function") return type.name;
  const declared = type as { type?: unknown; length?: unknown };
  if (typeof declared.type === "function") {
    return `${declared.type.name}(${typeof declared.length === "number" ? declared.length : ""})`;
  }
  return JSON.stringify(type);
}

function normalize(queries: readonly RecordedQuery[]): GoldenScenario["queries"] {
  return queries.map((query) => ({
    sql: query.sql,
    inputs: Object.fromEntries(
      Object.entries(query.inputs).map(([key, value]) => [key, value instanceof Date ? "<date>" : value]),
    ),
    types: Object.fromEntries(Object.keys(query.types).map((key) => [key, typeName(query.types[key])])),
    multiple: query.multiple,
  }));
}

const SCENARIOS: Record<
  string,
  { handler: QueryHandler; run: (db: ReturnType<typeof createFakeDatabase>) => Promise<unknown> }
> = {
  "players list": { handler: () => ({ recordset: [] }), run: (db) => getPlayersList(db) },
  "player profile": {
    handler: () => ({ recordsets: EMPTY_PROFILE }),
    run: (db) => getPlayerProfile(db, silentLogger, 7),
  },
  "profile by discord id": {
    handler: (sql) =>
      sql.includes("@discordMention")
        ? { recordset: [{ player_id: 7, name: "Someone", discord_id: "123456789012345678" }] }
        : { recordsets: EMPTY_PROFILE },
    run: (db) => getPlayerProfileByDiscordId(db, silentLogger, "123456789012345678"),
  },
  "clubs list": { handler: () => ({ recordset: [] }), run: (db) => getMsblClubs(db, noLogos) },
  "club profile": {
    handler: (sql) =>
      sql.includes("FROM Club c")
        ? { recordset: [{ club_id: 5, tag: "TAG", name: "Club", is_open: 1, owner_raw: "" }] }
        : { recordset: [] },
    run: (db) => getMsblClubProfile(db, { logoCache: noLogos, users: noNames }, 5),
  },
  "leaderboard msc elo1v1": {
    handler: () => ({ recordset: [] }),
    run: (db) => getLeaderboardRows(db, { gameCode: "msc", modeCode: "elo1v1", limit: 10, offset: 0 }, LIMITS),
  },
  "leaderboard msbl elo2v2": {
    handler: () => ({ recordset: [] }),
    run: (db) => getLeaderboardRows(db, { gameCode: "msbl", modeCode: "elo2v2", limit: 25, offset: 5 }, LIMITS),
  },
  "leaderboard msbl whr": {
    handler: whrHandler,
    run: (db) => getLeaderboardRows(db, { gameCode: "msbl", modeCode: "whr", limit: 100, offset: 0 }, LIMITS),
  },
  "leaderboard sms whr": {
    handler: whrHandler,
    run: (db) => getLeaderboardRows(db, { gameCode: "sms", modeCode: "whr", limit: 100, offset: 0 }, LIMITS),
  },
  "competitive season": { handler: () => ({ recordset: [] }), run: (db) => getCompetitiveSeasonStatus(db) },
};

test("every recorded scenario is covered", () => {
  assert.deepEqual(Object.keys(SCENARIOS).sort(), golden.map((scenario) => scenario.name).sort());
});

for (const scenario of golden) {
  test(`SQL is unchanged: ${scenario.name}`, async () => {
    const definition = SCENARIOS[scenario.name];
    assert.ok(definition, scenario.name);
    const database = createFakeDatabase(definition.handler);
    await definition.run(database);
    assert.deepEqual(normalize(database.queries), scenario.queries);
  });
}
