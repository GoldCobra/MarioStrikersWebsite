import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDatabase, type FakeDatabase } from "../../test-support/fake-database.ts";
import { GIANT, GOLDCOBRA, TITLE_CATEGORIES, seededCatalog } from "./catalog.ts";
import { TEST_UNLOCK_LOG_COMMAND, runTestUnlocks, testableTitles } from "./title-test-unlocks.ts";

const CATALOG = seededCatalog();
const id = (code: string): number => CATALOG.find((title) => title.code === code)?.id ?? 0;

interface State {
  regular: number[];
  tests: number[];
  selected: number | null;
  /** The parameter values of every dbo.CommandLog row: command, then parameters. */
  log: unknown[][];
  touchedRegular: boolean;
  /** For every cleared selection: whether its transaction had the activity triggers paused. */
  clearsWhilePaused: boolean[];
}

/** A database that answers from `state` and changes it as the statements would. */
function databaseFor(state: State, playerExists = true): FakeDatabase {
  const categories = new Map(TITLE_CATEGORIES.map((category) => [category.code, category]));
  const database = createFakeDatabase(({ text, values }) => {
    if (text.includes("FROM dbo.PlayerTitleTestUnlock x WITH (UPDLOCK, HOLDLOCK)")) {
      const titleId = (titleIdValue: number) => ({ TitleId: titleIdValue });
      return {
        sets: [
          playerExists ? [{ ID: values[0] }] : [],
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
    if (text.includes("INSERT INTO dbo.PlayerTitleTestUnlock")) {
      // Values: PlayerId, TitleId, GrantedBy, Note, then PlayerId and TitleId of the NOT EXISTS.
      const titleId = Number(values[1]);
      if (state.tests.includes(titleId)) return { affected: [0] };
      state.tests.push(titleId);
      return { affected: [1] };
    }
    if (text.includes("DELETE FROM dbo.PlayerTitleTestUnlock")) {
      const removed = state.tests.length;
      state.tests = [];
      return { affected: [removed] };
    }
    if (text.includes("DELETE FROM dbo.PlayerActiveTitle")) {
      state.selected = null;
      state.clearsWhilePaused.push(database.transactions.at(-1) === "begin (activity paused)");
      return { affected: [1] };
    }
    if (text.includes("INSERT INTO dbo.CommandLog")) {
      state.log.push([...values]);
      return { affected: [1] };
    }
    if (/PlayerTitleUnlock\b/.test(text)) state.touchedRegular = true;
    throw new Error(`Unexpected SQL: ${text.trim().slice(0, 80)}`);
  });
  return database;
}

const goldCobra = (): State => ({
  regular: [id("wfc-200-0-season-world-record"), id("wfc-66-0-daily-world-record"), id("wfc-final-daily-leader")],
  tests: [],
  selected: id("three-ghosts"),
  log: [],
  touchedRegular: false,
  clearsWhilePaused: [],
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
  const dry = await runTestUnlocks(databaseFor(state), {
    playerId: GOLDCOBRA.player_id,
    mode: "grant-all",
    apply: false,
    grantedBy: "ops:title-test-unlocks",
  });
  assert.equal(dry.applied, false);
  assert.deepEqual(state.tests, []);
  assert.ok(dry.titles.includes("wfc-5012-daily-points-world-record"));
  assert.ok(!dry.titles.includes("wfc-66-0-daily-world-record"), "earned titles need no test unlock");

  const database = databaseFor(state);
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
  assert.equal(state.log[0]?.[0], TEST_UNLOCK_LOG_COMMAND);
  assert.deepEqual(state.regular.length, 3, "regular unlocks unchanged");

  const again = await runTestUnlocks(databaseFor(state), {
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
  const database = databaseFor(state);
  const report = await runTestUnlocks(database, {
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
  // An admin tool clearing the selection is no activity of the player, and the pause ends with its transaction.
  assert.deepEqual(state.clearsWhilePaused, [true]);
  assert.deepEqual(database.transactions, ["begin (activity paused)", "commit"]);
  assert.equal(state.log[0]?.[0], TEST_UNLOCK_LOG_COMMAND);

  // A selection of an earned title stays.
  const keeps = goldCobra();
  keeps.tests = [id("legacy-legend")];
  keeps.selected = id("wfc-66-0-daily-world-record");
  const kept = await runTestUnlocks(databaseFor(keeps), {
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
    runTestUnlocks(databaseFor(state, false), {
      playerId: GIANT.player_id,
      mode: "grant-all",
      apply: true,
      grantedBy: "x",
    }),
    /Player 17 does not exist/,
  );
  await assert.rejects(
    runTestUnlocks(databaseFor(state), {
      playerId: Number.NaN,
      mode: "revoke",
      apply: true,
      grantedBy: "x",
    }),
    /--player needs a player id/,
  );
  assert.deepEqual(state.tests, []);
});
