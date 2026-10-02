import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDatabase, type QueryHandler } from "../../test-support/fake-database.ts";
import { TITLE_ORDER_BACKUPS, applyTitleOrder } from "./title-order.ts";

/** The title tables as #66 left them (2026-10-02 08:01 UTC), held in memory. */
function liveTables(): {
  categories: Map<string, number>;
  titles: Map<string, { group: string | null; level: number | null }>;
  backups: Set<string>;
} {
  return {
    categories: new Map([
      ["msl", 1],
      ["competitive-season", 2],
      ["tournament", 3],
      ["special-pre-2014", 4],
      ["legacy-rank", 5],
      ["free", 6],
    ]),
    titles: new Map([
      ["tournament-winner", { group: "tournament-winner", level: 1 }],
      ["tournament-winner-green", { group: "tournament-winner", level: 5 }],
    ]),
    backups: new Set<string>(),
  };
}

function handlerFor(tables: ReturnType<typeof liveTables>, options: { lostTitle?: boolean } = {}): QueryHandler {
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
      if (tables.categories.get(code) !== inputs.from) return { rowsAffected: [0] };
      tables.categories.set(code, Number(inputs.to));
      return { rowsAffected: [1] };
    }
    if (sql.startsWith("UPDATE dbo.PlayerTitle SET")) {
      let changed = 0;
      for (const code of [inputs.t0, inputs.t1].map(String)) {
        const title = tables.titles.get(code);
        if (!title || (title.group === null && title.level === null)) continue;
        if (options.lostTitle && code === "tournament-winner-green") continue;
        tables.titles.set(code, { group: null, level: null });
        changed += 1;
      }
      return { rowsAffected: [changed] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
}

const writes = (sqls: readonly string[]): string[] => sqls.filter((sql) => /^(?:UPDATE|SELECT \* INTO)/.test(sql));

test("a dry run reports the 4 categories and 2 titles and writes nothing", async () => {
  const tables = liveTables();
  const db = createFakeDatabase(handlerFor(tables));
  const report = await applyTitleOrder(db, false);
  assert.equal(report.applied, false);
  assert.deepEqual(report.categorySortOrder, [
    "special-pre-2014: 4 -> 1",
    "msl: 1 -> 2",
    "competitive-season: 2 -> 3",
    "tournament: 3 -> 4",
  ]);
  assert.deepEqual(report.ungroupedTitles, [
    "tournament-winner: tournament-winner/1 -> NULL/NULL",
    "tournament-winner-green: tournament-winner/5 -> NULL/NULL",
  ]);
  assert.deepEqual(writes(db.queries.map((query) => query.sql)), []);
  assert.equal(tables.categories.get("msl"), 1);
});

test("--apply backs both tables up, then changes exactly those rows; a second run finds nothing", async () => {
  const tables = liveTables();
  const db = createFakeDatabase(handlerFor(tables));
  const report = await applyTitleOrder(db, true);
  assert.equal(report.applied, true);
  assert.equal(report.status, "changed 4 categories and 2 titles");
  assert.deepEqual([...tables.backups], TITLE_ORDER_BACKUPS);
  const sqls = db.queries.map((query) => query.sql);
  assert.ok(
    sqls.findIndex((sql) => sql.startsWith("SELECT * INTO")) < sqls.findIndex((sql) => sql.startsWith("UPDATE")),
  );
  assert.deepEqual(Object.fromEntries(tables.categories), {
    "special-pre-2014": 1,
    msl: 2,
    "competitive-season": 3,
    tournament: 4,
    "legacy-rank": 5,
    free: 6,
  });
  assert.deepEqual(
    [...tables.titles.values()],
    [
      { group: null, level: null },
      { group: null, level: null },
    ],
  );
  assert.deepEqual(db.transactions, ["begin", "commit"]);

  const again = createFakeDatabase(handlerFor(tables));
  const second = await applyTitleOrder(again, true);
  assert.equal(second.status, "nothing to change");
  assert.deepEqual(writes(again.queries.map((query) => query.sql)), []);
});

test("an unexpected database or a different count changes nothing", async () => {
  const partly = liveTables();
  partly.categories.set("special-pre-2014", 1);
  const db = createFakeDatabase(handlerFor(partly));
  await assert.rejects(applyTitleOrder(db, true), /Expected 4 categories and 2 titles to change, found 3 and 2/);
  assert.deepEqual(writes(db.queries.map((query) => query.sql)), []);
  assert.deepEqual(db.transactions, ["begin", "rollback"]);

  const backedUp = liveTables();
  backedUp.backups.add("dbo.PlayerTitle_Backup_20261002");
  const second = createFakeDatabase(handlerFor(backedUp));
  await assert.rejects(applyTitleOrder(second, true), /exists already/);
  assert.deepEqual(writes(second.queries.map((query) => query.sql)), []);

  const raced = createFakeDatabase(handlerFor(liveTables(), { lostTitle: true }));
  await assert.rejects(applyTitleOrder(raced, true), /Changed 4 categories and 1 titles instead of 4 and 2/);
  assert.deepEqual(raced.transactions, ["begin", "rollback"]);
});
