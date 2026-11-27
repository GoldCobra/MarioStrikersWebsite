import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDatabase, type RecordedStatement } from "../../test-support/fake-database.ts";
import {
  CREATE_REPORT_TABLE_SQL,
  EXPECTED_COLUMNS,
  EXPECTED_OBJECTS,
  REPORT_TABLE,
  applyRechargedSchema,
} from "./schema.ts";

/** Objects of the database before the change, a few of each kind the bots and the website have. */
const EXISTING = ["dbo.Player", "dbo.PK_Player", "rocci121_toby.RatedMatch", "rocci121_toby.CompetitivePlayerRating"];
const sorted = (values: readonly string[]): string[] => [...values].sort((a, b) => a.localeCompare(b));

interface Simulation {
  /** sys.objects before the CREATE TABLE (the first read) and after it. */
  readonly before?: readonly string[];
  readonly after?: readonly string[];
  readonly columns?: readonly string[];
  readonly reportRows?: readonly object[];
}

function simulate({
  before = EXISTING,
  after = [...EXISTING, ...EXPECTED_OBJECTS],
  columns = EXPECTED_COLUMNS,
  reportRows = [{ report_rows: 0 }],
}: Simulation = {}) {
  let objectReads = 0;
  return createFakeDatabase((statement: RecordedStatement) => {
    if (statement.text.includes("FROM sys.objects")) {
      objectReads += 1;
      return (objectReads === 1 ? before : after).map((name) => ({ name }));
    }
    if (statement.text.includes("FROM sys.columns")) return columns.map((description) => ({ description }));
    if (statement.text.includes("COUNT(*) AS report_rows")) return reportRows;
    return undefined;
  });
}

const createStatements = (db: { statements: RecordedStatement[] }): RecordedStatement[] =>
  db.statements.filter((statement) => statement.text.startsWith("CREATE TABLE"));

test("the dry run creates and checks the table in one transaction, then rolls it back", async () => {
  const db = simulate();
  assert.deepEqual(await applyRechargedSchema(db, { apply: false }), {
    applied: false,
    status: "dry run: created, checked and rolled back",
    createdObjects: sorted(EXPECTED_OBJECTS),
  });
  assert.deepEqual(db.transactions, ["begin", "rollback"]);
  assert.equal(createStatements(db).length, 1);
  assert.equal(createStatements(db)[0]?.text, CREATE_REPORT_TABLE_SQL);
  assert.deepEqual(createStatements(db)[0]?.values, []);
});

test("--apply commits the same checked change", async () => {
  const db = simulate();
  assert.deepEqual(await applyRechargedSchema(db, { apply: true }), {
    applied: true,
    status: "created",
    createdObjects: sorted(EXPECTED_OBJECTS),
  });
  assert.deepEqual(db.transactions, ["begin", "commit"]);
});

test("an existing complete table changes nothing; an existing other one is refused", async () => {
  const complete = simulate({ before: [...EXISTING, ...EXPECTED_OBJECTS] });
  assert.deepEqual(await applyRechargedSchema(complete, { apply: true }), {
    applied: false,
    status: "nothing to change",
    createdObjects: [],
  });
  assert.equal(createStatements(complete).length, 0);

  const missingCheck = simulate({
    before: [...EXISTING, ...EXPECTED_OBJECTS.filter((name) => !name.endsWith("_NoDraw"))],
  });
  await assert.rejects(
    applyRechargedSchema(missingCheck, { apply: true }),
    /exists but differs \(missing rocci121_toby\.CK_ExternalMatchReport_NoDraw\); nothing was changed/,
  );
  assert.equal(createStatements(missingCheck).length, 0);

  const otherColumns = simulate({
    before: [...EXISTING, ...EXPECTED_OBJECTS],
    columns: EXPECTED_COLUMNS.slice(1),
  });
  await assert.rejects(applyRechargedSchema(otherColumns, { apply: true }), /exists but differs \(other columns\)/);
});

test("every check failure rolls the whole change back, even with --apply", async () => {
  const failures: readonly [Simulation, RegExp][] = [
    [{ after: [...EXISTING.slice(1), ...EXPECTED_OBJECTS] }, /objects disappeared: dbo\.Player/],
    [{ after: [...EXISTING, ...EXPECTED_OBJECTS, "rocci121_toby.TR_Surprise"] }, /new objects: .*TR_Surprise/],
    [{ after: [...EXISTING, ...EXPECTED_OBJECTS.slice(1)] }, /new objects:/],
    [{ columns: [...EXPECTED_COLUMNS.slice(0, -1), "RejectReason nvarchar(100) NULL"] }, /the columns differ/],
    [{ reportRows: [{ report_rows: 1 }] }, /the new table is not empty/],
    [{ reportRows: [] }, /the new table is not empty/],
  ];
  for (const [simulation, message] of failures) {
    const db = simulate(simulation);
    await assert.rejects(applyRechargedSchema(db, { apply: true }), message);
    assert.deepEqual(db.transactions, ["begin", "rollback"]);
  }
});

test("the statement only creates: no existing object or row can be touched", () => {
  assert.match(CREATE_REPORT_TABLE_SQL, /^CREATE TABLE rocci121_toby\.ExternalMatchReport \(/);
  assert.doesNotMatch(CREATE_REPORT_TABLE_SQL, /\b(DROP|ALTER|DELETE|UPDATE|TRUNCATE|INSERT|MERGE|EXEC|GRANT|DENY)\b/i);
  assert.equal(CREATE_REPORT_TABLE_SQL.match(/\bCREATE\b/g)?.length, 1);
});

test("the expected objects and columns are exactly those the statement declares", () => {
  const constraints = [...CREATE_REPORT_TABLE_SQL.matchAll(/CONSTRAINT (\w+)/g)].map(
    (match) => `rocci121_toby.${match[1] ?? ""}`,
  );
  assert.deepEqual(sorted([REPORT_TABLE, ...constraints]), sorted(EXPECTED_OBJECTS));
  assert.equal(new Set(EXPECTED_OBJECTS).size, EXPECTED_OBJECTS.length);

  const declared = [
    ...CREATE_REPORT_TABLE_SQL.matchAll(/^ {2}(\w+) (?:INT|TINYINT|VARCHAR|NVARCHAR|DATETIME2)\b/gm),
  ].map((match) => match[1]);
  assert.deepEqual(
    declared,
    EXPECTED_COLUMNS.map((column) => column.split(" ")[0]),
  );
});
