import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDatabase, type QueryHandler } from "../../test-support/fake-database.ts";
import { GIANT, GOLDCOBRA, TITLE_CATEGORIES, seededCatalog } from "./catalog.ts";
import { TEST_UNLOCK_LOG_COMMAND, runTestUnlocks, testableTitles } from "./title-test-unlocks.ts";

const CATALOG = seededCatalog();
const id = (code: string): number => CATALOG.find((title) => title.code === code)?.id ?? 0;

interface State {
  regular: number[];
  tests: number[];
  selected: number | null;
  log: string[];
  touchedRegular: boolean;
}

function handlerFor(state: State, playerExists = true): QueryHandler {
  const categories = new Map(TITLE_CATEGORIES.map((category) => [category.code, category]));
  return (sql, inputs) => {
    if (sql.includes("FROM dbo.PlayerTitleTestUnlock x WITH (UPDLOCK, HOLDLOCK)")) {
      const titleId = (titleIdValue: number) => ({ TitleId: titleIdValue });
      return {
        recordsets: [
          playerExists ? [{ ID: inputs.playerId }] : [],
          state.regular.map(titleId),
          state.tests.map(titleId),
          state.selected === null ? [] : [titleId(state.selected)],
          CATALOG.map((title) => {
            const category = categories.get(title.category);
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
              CategoryName: category?.name,
              CategorySort: category?.sortOrder,
              IsGlobal: category?.isGlobal,
            };
          }),
        ],
      };
    }
    if (sql.startsWith("INSERT INTO dbo.PlayerTitleTestUnlock")) {
      const titleId = Number(inputs.titleId);
      if (state.tests.includes(titleId)) return { rowsAffected: [0] };
      state.tests.push(titleId);
      return { rowsAffected: [1] };
    }
    if (sql.startsWith("DELETE FROM dbo.PlayerTitleTestUnlock")) {
      const removed = state.tests.length;
      state.tests = [];
      return { rowsAffected: [removed] };
    }
    if (sql.startsWith("DELETE FROM dbo.PlayerActiveTitle")) {
      state.selected = null;
      return { rowsAffected: [1] };
    }
    if (sql.startsWith("INSERT INTO dbo.CommandLog")) {
      state.log.push(sql + " " + String(inputs.log));
      return { rowsAffected: [1] };
    }
    if (/PlayerTitleUnlock\b/.test(sql)) state.touchedRegular = true;
    throw new Error(`Unexpected SQL: ${sql.slice(0, 80)}`);
  };
}

const goldCobra = (): State => ({
  regular: [id("wfc-200-0-season-world-record"), id("wfc-66-0-daily-world-record"), id("wfc-final-daily-leader")],
  tests: [],
  selected: id("three-ghosts"),
  log: [],
  touchedRegular: false,
});

test("test unlocks cover every selectable title the player has not earned, nothing global, retired or a template", () => {
  const titles = testableTitles(CATALOG, [id("legacy-rookie")]).map((title) => title.code);
  assert.ok(titles.includes("wfc-5012-daily-points-world-record"), "another player's fixed title too");
  assert.ok(titles.includes("msl-5-time-world-champion-sms") && titles.includes("tournament-winner-green-msbl"));
  assert.ok(titles.includes("legacy-megastriker") && !titles.includes("legacy-rookie"));
  assert.ok(!titles.includes("og-player"), "Free Titles need none");
  assert.ok(!titles.includes("msl-2023-world-champion"), "a template is never selectable");
  assert.ok(!titles.includes("tournament-winner"), "a retired title is never selectable");
});

test("grant-all reports first, then writes only test unlocks, once", async () => {
  const state = goldCobra();
  const dry = await runTestUnlocks(createFakeDatabase(handlerFor(state)), {
    playerId: GOLDCOBRA.player_id,
    mode: "grant-all",
    apply: false,
    grantedBy: "ops:title-test-unlocks",
  });
  assert.equal(dry.applied, false);
  assert.deepEqual(state.tests, []);
  assert.ok(dry.titles.includes("wfc-5012-daily-points-world-record"));
  assert.ok(!dry.titles.includes("wfc-66-0-daily-world-record"), "earned titles need no test unlock");

  const database = createFakeDatabase(handlerFor(state));
  const applied = await runTestUnlocks(database, {
    playerId: GOLDCOBRA.player_id,
    mode: "grant-all",
    apply: true,
    grantedBy: "ops:title-test-unlocks",
  });
  assert.equal(applied.applied, true);
  assert.equal(state.tests.length, dry.titles.length);
  assert.equal(state.touchedRegular, false);
  assert.deepEqual(database.transactions, ["begin", "commit"]);
  assert.match(state.log[0] ?? "", new RegExp(`N'${TEST_UNLOCK_LOG_COMMAND}'`));
  assert.deepEqual(state.regular.length, 3, "regular unlocks unchanged");

  const again = await runTestUnlocks(createFakeDatabase(handlerFor(state)), {
    playerId: GOLDCOBRA.player_id,
    mode: "grant-all",
    apply: true,
    grantedBy: "ops:title-test-unlocks",
  });
  assert.deepEqual(again.titles, []);
  assert.equal(state.log.length, 1, "nothing to grant, nothing logged");
});

test("revoke removes only the test unlocks, and a selection only a test unlock allowed", async () => {
  const state = goldCobra();
  state.tests = [id("wfc-5012-daily-points-world-record"), id("legacy-legend")];
  state.selected = id("wfc-5012-daily-points-world-record");
  const report = await runTestUnlocks(createFakeDatabase(handlerFor(state)), {
    playerId: GOLDCOBRA.player_id,
    mode: "revoke",
    apply: true,
    grantedBy: "ops:title-test-unlocks",
  });
  assert.deepEqual(report.titles, ["wfc-5012-daily-points-world-record", "legacy-legend"]);
  assert.equal(report.clearedSelection, "wfc-5012-daily-points-world-record");
  assert.deepEqual(state.tests, []);
  assert.equal(state.selected, null);
  assert.equal(state.regular.length, 3, "earned and fixed titles stay");
  assert.equal(state.touchedRegular, false);

  // A selection of an earned title stays.
  const keeps = goldCobra();
  keeps.tests = [id("legacy-legend")];
  keeps.selected = id("wfc-66-0-daily-world-record");
  const kept = await runTestUnlocks(createFakeDatabase(handlerFor(keeps)), {
    playerId: GOLDCOBRA.player_id,
    mode: "revoke",
    apply: true,
    grantedBy: "ops:title-test-unlocks",
  });
  assert.equal(kept.clearedSelection, "");
  assert.equal(keeps.selected, id("wfc-66-0-daily-world-record"));
});

test("an unknown player or no player id changes nothing", async () => {
  const state = goldCobra();
  await assert.rejects(
    runTestUnlocks(createFakeDatabase(handlerFor(state, false)), {
      playerId: GIANT.player_id,
      mode: "grant-all",
      apply: true,
      grantedBy: "x",
    }),
    /Player 17 does not exist/,
  );
  await assert.rejects(
    runTestUnlocks(createFakeDatabase(handlerFor(state)), {
      playerId: Number.NaN,
      mode: "revoke",
      apply: true,
      grantedBy: "x",
    }),
    /--player needs a player id/,
  );
  assert.deepEqual(state.tests, []);
});
