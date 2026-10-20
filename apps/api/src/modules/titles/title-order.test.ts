import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDatabase, type QueryHandler } from "../../test-support/fake-database.ts";
import { TITLE_ORDER_BACKUPS, applyTitleOrder } from "./title-order.ts";

/** The title tables after ops:player-titles of 2026-10-20 added the developer category, held in memory. */
function liveTables(): {
  categories: Map<string, number>;
  titles: Map<string, { group: string | null; level: number | null }>;
  backups: Set<string>;
} {
  return {
    categories: new Map([
      ["special-pre-2014", 1],
      ["developer", 1],
      ["msl", 2],
      ["competitive-season", 3],
      ["tournament", 4],
      ["legacy-rank", 5],
      ["free", 6],
    ]),
    titles: new Map([
      ["tournament-winner", { group: null, level: null }],
      ["tournament-winner-green", { group: null, level: null }],
    ]),
    backups: new Set<string>(),
  };
}

function handlerFor(tables: ReturnType<typeof liveTables>, options: { lostCategory?: boolean } = {}): QueryHandler {
  return (sql, inputs) => {
    if (sql.startsWith("SELECT Code, SortOrder FROM dbo.PlayerTitleCategory")) {
      return { recordset: [...tables.categories].map(([Code, SortOrder]) => ({ Code, SortOrder })) };
    }
    if (sql.startsWith("SELECT Code, ExclusiveGroup, ExclusiveLevel FROM dbo.PlayerTitle")) {
      const codes = [inputs.t0, inputs.t1];
      return {
        recordset: [...tables.titles]
          .filter(([code]) => codes.includes(code))
          .map(([Code, title]) => ({ Code, ExclusiveGroup: title.group, ExclusiveLevel: title.level })),
      };
    }
    if (sql.startsWith("SELECT OBJECT_ID(@name")) {
      return { recordset: [{ id: tables.backups.has(String(inputs.name)) ? 1 : null }] };
    }
    const backup = /^SELECT \* INTO (\S+) FROM/.exec(sql);
    if (backup?.[1]) {
      tables.backups.add(backup[1]);
      return { rowsAffected: [1] };
    }
    if (sql.startsWith("UPDATE dbo.PlayerTitleCategory")) {
      const code = String(inputs.code);
      if (options.lostCategory || tables.categories.get(code) !== inputs.from) return { rowsAffected: [0] };
      tables.categories.set(code, Number(inputs.to));
      return { rowsAffected: [1] };
    }
    if (sql.startsWith("UPDATE dbo.PlayerTitle SET")) {
      let changed = 0;
      for (const code of [inputs.t0, inputs.t1].map(String)) {
        const title = tables.titles.get(code);
        if (!title || (title.group === null && title.level === null)) continue;
        tables.titles.set(code, { group: null, level: null });
        changed += 1;
      }
      return { rowsAffected: [changed] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
}

const writes = (sqls: readonly string[]): string[] => sqls.filter((sql) => /^(?:UPDATE|SELECT \* INTO)/.test(sql));

test("a dry run reports the special category's move and writes nothing", async () => {
  const tables = liveTables();
  const db = createFakeDatabase(handlerFor(tables));
  const report = await applyTitleOrder(db, false);
  assert.equal(report.applied, false);
  assert.deepEqual(report.categorySortOrder, ["special-pre-2014: 1 -> 0"]);
  assert.deepEqual(report.ungroupedTitles, []);
  assert.deepEqual(writes(db.queries.map((query) => query.sql)), []);
  assert.equal(tables.categories.get("special-pre-2014"), 1);
});

test("--apply backs both tables up, then changes exactly that row; a second run finds nothing", async () => {
  const tables = liveTables();
  const db = createFakeDatabase(handlerFor(tables));
  const report = await applyTitleOrder(db, true);
  assert.equal(report.applied, true);
  assert.equal(report.status, "changed 1 categories and 0 titles");
  assert.deepEqual([...tables.backups], TITLE_ORDER_BACKUPS);
  const sqls = db.queries.map((query) => query.sql);
  assert.ok(
    sqls.findIndex((sql) => sql.startsWith("SELECT * INTO")) < sqls.findIndex((sql) => sql.startsWith("UPDATE")),
  );
  // The developer titles follow the WFC titles; the others keep their SortOrder.
  assert.deepEqual(Object.fromEntries(tables.categories), {
    "special-pre-2014": 0,
    developer: 1,
    msl: 2,
    "competitive-season": 3,
    tournament: 4,
    "legacy-rank": 5,
    free: 6,
  });
  assert.deepEqual(db.transactions, ["begin", "commit"]);

  const again = createFakeDatabase(handlerFor(tables));
  const second = await applyTitleOrder(again, true);
  assert.equal(second.status, "nothing to change");
  assert.deepEqual(writes(again.queries.map((query) => query.sql)), []);
});

test("an unexpected database or a different count changes nothing", async () => {
  const missing = liveTables();
  missing.categories.delete("developer");
  const first = createFakeDatabase(handlerFor(missing));
  await assert.rejects(applyTitleOrder(first, true), /Category developer is missing; run ops:player-titles first/);
  assert.deepEqual(writes(first.queries.map((query) => query.sql)), []);

  const grouped = liveTables();
  grouped.titles.set("tournament-winner", { group: "tournament-winner", level: 1 });
  const db = createFakeDatabase(handlerFor(grouped));
  await assert.rejects(applyTitleOrder(db, true), /Expected 1 categories and 0 titles to change, found 1 and 1/);
  assert.deepEqual(writes(db.queries.map((query) => query.sql)), []);
  assert.deepEqual(db.transactions, ["begin", "rollback"]);

  const backedUp = liveTables();
  backedUp.backups.add("dbo.PlayerTitle_Backup_20261020");
  const second = createFakeDatabase(handlerFor(backedUp));
  await assert.rejects(applyTitleOrder(second, true), /exists already/);
  assert.deepEqual(writes(second.queries.map((query) => query.sql)), []);

  const raced = createFakeDatabase(handlerFor(liveTables(), { lostCategory: true }));
  await assert.rejects(applyTitleOrder(raced, true), /Changed 0 categories and 0 titles instead of 1 and 0/);
  assert.deepEqual(raced.transactions, ["begin", "rollback"]);
});
