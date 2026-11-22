import assert from "node:assert/strict";
import { test } from "node:test";
import mssql from "mssql";
import { inferType, render, sql, t } from "./sql.ts";

test("every value becomes a numbered parameter, never text", () => {
  const name = "Robert'); DROP TABLE dbo.Player;--";
  const { text, parameters } = render(sql`SELECT ID FROM dbo.Player WHERE Name = ${name} AND ID > ${7};`);
  assert.equal(text, "SELECT ID FROM dbo.Player WHERE Name = @p0 AND ID > @p1;");
  assert.deepEqual(
    parameters.map((parameter) => [parameter.name, parameter.value]),
    [
      ["p0", name],
      ["p1", 7],
    ],
  );
});

test("parts nest and keep one numbering", () => {
  const filter = sql`c.Region = ${"EU"}`;
  const { text, parameters } = render(
    sql`SELECT c.ID FROM dbo.Club c WHERE c.ID > ${10} AND ${filter} AND c.IsOpen = ${true};`,
  );
  assert.equal(text, "SELECT c.ID FROM dbo.Club c WHERE c.ID > @p0 AND c.Region = @p1 AND c.IsOpen = @p2;");
  assert.deepEqual(
    parameters.map((parameter) => parameter.value),
    [10, "EU", true],
  );
});

test("join puts a separator between parts; list makes a parameter of each value", () => {
  const set = sql.join([sql`ClubName = ${"Alpha"}`, sql`ClanTag = ${"ALP"}`]);
  const update = render(sql`UPDATE dbo.Club SET ${set} WHERE ID IN (${sql.list([1, 2, 3])});`);
  assert.equal(update.text, "UPDATE dbo.Club SET ClubName = @p0, ClanTag = @p1 WHERE ID IN (@p2, @p3, @p4);");
  assert.equal(render(sql.join([])).text, "");
  assert.equal(render(sql`a ${sql.join([sql`x`, sql`y`], " AND ")} b`).text, "a x AND y b");
  assert.throws(() => sql.list([]), /at least one value/);
});

test("raw text is part of the statement", () => {
  const direction = sql.raw("DESC");
  assert.equal(
    render(sql`SELECT ID FROM dbo.Player ORDER BY ID ${direction};`).text,
    "SELECT ID FROM dbo.Player ORDER BY ID DESC;",
  );
});

test("plain values get their SQL type from their JavaScript type", () => {
  const name = (value: Parameters<typeof inferType>[0]): string => {
    const inferred = inferType(value);
    const type = (typeof inferred === "function" ? inferred() : inferred) as {
      type: { declaration: string };
      length?: number;
    };
    return type.type.declaration + (type.length === undefined ? "" : `(${String(type.length)})`);
  };
  assert.equal(name(42), "int");
  assert.equal(name(3_000_000_000), "bigint");
  assert.equal(name(1.5), "float");
  assert.equal(name(true), "bit");
  assert.equal(name("text"), "nvarchar(4000)");
  assert.equal(name("x".repeat(4001)), `nvarchar(${String(mssql.MAX)})`);
  assert.equal(name(new Date(0)), "datetime2");
  assert.equal(name(Buffer.from("a")), `varbinary(${String(mssql.MAX)})`);
  assert.equal(name(null), "nvarchar(4000)");
});

test("typed values keep the column's type", () => {
  const at = Date.UTC(2026, 10, 22);
  const { parameters } = render(
    sql`UPDATE dbo.Club SET ClubName = ${t.nvarchar("Alpha", 50)}, CreatedAtUtc = ${t.dateTime2(at, 0)};`,
  );
  const [name, created] = parameters;
  assert.equal((name?.type as { length?: number }).length, 50);
  assert.equal((created?.type as { scale?: number }).scale, 0);
  assert.deepEqual(created?.value, new Date(at));
});
