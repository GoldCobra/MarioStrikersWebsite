import assert from "node:assert/strict";
import test from "node:test";
import { silentLogger, type Logger } from "../../lib/logger.ts";
import { createFakeDatabase, type QueryHandler } from "../../test-support/fake-database.ts";
import { seededCatalog } from "./catalog.ts";
import { createTitleSyncSchedule, isSyncDue, runTitleSync } from "./service.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-02T12:00:00Z");

// The catalog as the database holds it, one World Championship (MSC) won by player 9.
function catalogRow(title: ReturnType<typeof seededCatalog>[number]): Record<string, unknown> {
  return {
    Id: title.id,
    Code: title.code,
    Name: title.name,
    CategoryCode: title.category,
    SortOrder: title.sortOrder,
    RuleKind: title.ruleKind,
    RuleParams: title.ruleParams || null,
    StyleKey: title.styleKey || null,
    ExclusiveGroup: title.exclusiveGroup || null,
    ExclusiveLevel: title.exclusiveLevel || null,
    GameCode: title.gameCode || null,
    IsActive: title.isActive,
    CategoryName: title.categoryName,
    CategorySort: title.categorySort,
    IsGlobal: title.isGlobal,
  };
}

function handler(lastRun: Date | null): QueryHandler {
  return (sql, inputs) => {
    if (sql.includes("TOP 1 TimeOfCommand")) return { recordset: lastRun ? [{ TimeOfCommand: lastRun }] : [] };
    if (sql.includes("INSERT INTO dbo.PlayerTitleUnlock")) {
      return { recordset: [{ inserted: Object.keys(inputs).filter((name) => name.startsWith("player")).length }] };
    }
    if (sql.includes("FROM dbo.Tournament")) {
      return {
        recordsets: [
          seededCatalog().map(catalogRow),
          [],
          [{ ID: 9 }],
          [
            {
              ID: 211,
              Name: "MSL 2023 World Championship",
              GameType: 1,
              IsComplete: true,
              Winner: "9",
              TournamentStartDate: "2023-12-06",
            },
          ],
          [],
          [],
        ],
      };
    }
    return { recordset: [] };
  };
}

test("a run is due when none was logged or the last one is a day old", () => {
  assert.equal(isSyncDue(null, NOW, DAY_MS), true);
  assert.equal(isSyncDue(new Date(NOW - DAY_MS), NOW, DAY_MS), true);
  assert.equal(isSyncDue(new Date(NOW - DAY_MS + 1000), NOW, DAY_MS), false);
});

test("without apply the run only reports; with apply it writes and logs", async () => {
  const dry = createFakeDatabase(handler(null));
  const report = await runTitleSync(dry, { apply: false, legacy: false, grantedBy: "ops:title-sync" });
  assert.deepEqual(report.byTitle, { "msl-2023-world-champion-msc": 1 });
  assert.deepEqual(report.newTitles, ["MSL 2023 WORLD CHAMPION"]);
  assert.equal(report.granted, 0);
  assert.deepEqual(dry.transactions, []);

  const applied = createFakeDatabase(handler(null));
  const written = await runTitleSync(applied, { apply: true, legacy: false, grantedBy: "ops:title-sync" });
  assert.equal(written.granted, 1);
  assert.deepEqual(applied.transactions, ["begin", "commit"]);
  const log = applied.queries.find((query) => query.sql.includes("CommandLog"));
  assert.deepEqual(JSON.parse(String(log?.inputs.log)), {
    granted_by: "ops:title-sync",
    granted: 1,
    titles: { "msl-2023-world-champion-msc": 1 },
    new_titles: ["MSL 2023 WORLD CHAMPION"],
    // The fixed WFC titles (their players are not in this data) and MSL 2025 SPRING CHAMPION.
    open_points: 5,
  });
});

test("the daily check runs the sync only when it is due and never throws", async () => {
  const quiet = createFakeDatabase(handler(new Date(NOW - 60_000)));
  let invalidated = 0;
  const catalog = {
    invalidate: () => {
      invalidated += 1;
    },
  };
  await createTitleSyncSchedule({
    database: quiet,
    log: silentLogger,
    catalog,
    intervalMs: DAY_MS,
    now: () => NOW,
  }).check();
  assert.equal(quiet.queries.length, 1, "only the last run was read");

  const due = createFakeDatabase(handler(new Date(NOW - 2 * DAY_MS)));
  await createTitleSyncSchedule({
    database: due,
    log: silentLogger,
    catalog,
    intervalMs: DAY_MS,
    now: () => NOW,
  }).check();
  assert.deepEqual(due.transactions, ["begin", "commit"]);
  assert.equal(invalidated, 1, "the new MSL 2023 WORLD CHAMPION (MSC) shows at once");

  const warnings: unknown[] = [];
  const log: Logger = { ...silentLogger, warn: (...args: unknown[]) => warnings.push(args) };
  const broken = createFakeDatabase(() => {
    throw new Error("Connection is closed.");
  });
  await createTitleSyncSchedule({ database: broken, log, catalog, intervalMs: DAY_MS, now: () => NOW }).check();
  assert.equal(warnings.length, 1);
});

test("an interval of 0 switches the schedule off", () => {
  const database = createFakeDatabase(handler(null));
  const schedule = createTitleSyncSchedule({
    database,
    log: silentLogger,
    catalog: { invalidate: () => undefined },
    intervalMs: 0,
    firstCheckMs: 0,
  });
  schedule.start();
  schedule.stop();
  assert.equal(database.queries.length, 0);
});
