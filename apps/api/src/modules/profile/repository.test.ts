import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDatabase } from "../../test-support/fake-database.ts";
import { isUniqueViolation } from "../../lib/sql-errors.ts";
import {
  buildApplyQuery,
  buildEnsurePlayerQuery,
  buildProfileQuery,
  buildTakenCodesQuery,
  createSqlProfileStore,
} from "./repository.ts";

const DISCORD_ID = "709777875686916210";

function duplicateKeyError(): Error {
  return Object.assign(new Error("Cannot insert duplicate key row in object 'dbo.Player'."), { number: 2601 });
}

test("the profile is created in one locked batch and logged like the bot's procedures", () => {
  const sql = buildEnsurePlayerQuery();
  assert.match(sql, /^SET XACT_ABORT ON; SET NOCOUNT ON; BEGIN TRANSACTION;/);
  assert.match(sql, /FROM dbo\.Player WITH \(UPDLOCK, HOLDLOCK\) WHERE DiscordID = @discordId/);
  assert.match(sql, /INSERT INTO dbo\.Player \(Name, DiscordID\) VALUES \(@name, @discordId\);/);
  assert.match(sql, /SET @playerId = CONVERT\(INT, SCOPE_IDENTITY\(\)\);/);
  assert.match(
    sql,
    /INSERT INTO dbo\.CommandLog \(Command, Parameters\) VALUES \(N'WebsiteCreatePlayer', @logParameters\);/,
  );
  assert.match(sql, /COMMIT TRANSACTION; SELECT @playerId AS player_id, @created AS created;$/);
});

test("ensurePlayer returns the created or reused player with typed parameters", async () => {
  const database = createFakeDatabase(() => ({ recordset: [{ player_id: 1124, created: true }] }));
  const store = createSqlProfileStore(database);
  assert.deepEqual(await store.ensurePlayer(DISCORD_ID, "GoldCobra"), { playerId: 1124, created: true });
  const [query] = database.queries;
  assert.equal(query?.inputs.discordId, DISCORD_ID);
  assert.equal(query.inputs.name, "GoldCobra");
  assert.deepEqual(JSON.parse(String(query.inputs.logParameters)), {
    discord_id: DISCORD_ID,
    name: "GoldCobra",
    source: "website login",
  });

  const reused = createSqlProfileStore(createFakeDatabase(() => ({ recordset: [{ player_id: 223, created: false }] })));
  assert.deepEqual(await reused.ensurePlayer(DISCORD_ID, "GoldCobra"), { playerId: 223, created: false });
});

test("a parallel insert of the same Discord id is answered with that row", async () => {
  let calls = 0;
  const database = createFakeDatabase(() => {
    calls += 1;
    if (calls === 1) throw duplicateKeyError();
    return { recordset: [{ player_id: 223, created: 0 }] };
  });
  assert.deepEqual(await createSqlProfileStore(database).ensurePlayer(DISCORD_ID, "GoldCobra"), {
    playerId: 223,
    created: false,
  });
  assert.equal(database.queries.length, 2);
});

test("other database errors and empty answers are reported", async () => {
  const failing = createFakeDatabase(() => {
    throw new Error("Connection is closed.");
  });
  await assert.rejects(createSqlProfileStore(failing).ensurePlayer(DISCORD_ID, "GoldCobra"), /Connection is closed/);
  const empty = createFakeDatabase(() => ({ recordset: [] }));
  await assert.rejects(createSqlProfileStore(empty).ensurePlayer(DISCORD_ID, "GoldCobra"), /could not be created/);
});

test("duplicate key errors are recognised in both forms mssql reports", () => {
  assert.equal(isUniqueViolation(duplicateKeyError()), true);
  assert.equal(isUniqueViolation({ originalError: { info: { number: 2627 } } }), true);
  assert.equal(isUniqueViolation(new Error("Timeout")), false);
  assert.equal(isUniqueViolation(null), false);
});

test("the editor reads the profile, under update locks when it saves", () => {
  assert.doesNotMatch(buildProfileQuery(false), /UPDLOCK/);
  const locked = buildProfileQuery(true);
  assert.match(locked, /FROM dbo\.Player p WITH \(UPDLOCK, HOLDLOCK\) WHERE p\.ID = @playerId;/);
  assert.match(locked, /FROM dbo\.FriendCodes fc WITH \(UPDLOCK, HOLDLOCK\) WHERE fc\.Player = @playerId/);
  assert.equal(buildTakenCodesQuery(0), "");
  assert.equal(
    buildTakenCodesQuery(2),
    "SELECT fc.GameType, fc.Code FROM dbo.FriendCodes fc WHERE fc.Player <> @playerId AND " +
      "((fc.GameType = @takenGame0 AND fc.Code = @takenCode0) OR (fc.GameType = @takenGame1 AND fc.Code = @takenCode1));",
  );
});

test("a plan becomes deletes, ascending updates, inserts and the audit row, all parameterised", () => {
  const inputs: Record<string, unknown> = {};
  const request = {
    input(name: string, _type: unknown, value: unknown) {
      inputs[name] = value;
      return request;
    },
  } as unknown as Parameters<typeof buildApplyQuery>[1];
  const row = (lineSeq: number, code: string) => ({ gameType: 1, region: "PAL", lineSeq, label: "Wii", code });
  const sql = buildApplyQuery(
    {
      country: "us",
      deletes: [row(1, "1111-1111-1111")],
      updates: [{ row: row(2, "2222-2222-2222"), label: "Dolphin", lineSeq: 1 }],
      inserts: [{ gameType: 3, region: "SW", lineSeq: 1, label: "", code: "0001-0002-0003" }],
    },
    request,
  );
  const statements = sql.split(/;\s*/).filter(Boolean);
  assert.deepEqual(
    statements.map((statement) => statement.split(" ").slice(0, 2).join(" ")),
    ["SET XACT_ABORT", "UPDATE dbo.Player", "DELETE FROM", "UPDATE dbo.FriendCodes", "INSERT INTO", "INSERT INTO"],
  );
  assert.match(sql, /INSERT INTO dbo\.CommandLog \(Command, Parameters\) VALUES \(N'WebsiteProfileSave', @audit\);$/);
  assert.equal(inputs.country, "us");
  assert.equal(inputs.delSeq0, 1);
  assert.deepEqual([inputs.updSeq0, inputs.updNewSeq0, inputs.updLabel0], [2, 1, "Dolphin"]);
  assert.equal(inputs.insCode0, "0001-0002-0003");
  assert.doesNotMatch(sql, /0001-0002-0003|Dolphin/);
});

test("a save reads, decides and writes in one transaction; a failure rolls it back", async () => {
  const profileSets = [
    [{ country: "de" }],
    [{ GameType: 3, Region: "SW", LineSeq: 1, Label: "", Code: "0012-0000-0340" }],
    [],
  ];
  const database = createFakeDatabase((sql) =>
    sql.includes("UPDLOCK") ? { recordsets: profileSets } : { recordset: [] },
  );
  const store = createSqlProfileStore(database);
  const result = await store.saveProfile(223, [{ gameType: 3, code: "0001-0002-0003" }], (current, taken) => {
    assert.deepEqual(current, {
      playerId: 223,
      country: "de",
      codes: [{ gameType: 3, region: "SW", lineSeq: 1, label: "", code: "0012-0000-0340" }],
    });
    assert.deepEqual(taken, []);
    return { plan: { country: "us", deletes: [], updates: [], inserts: [] }, audit: "{}", result: "done" };
  });
  assert.equal(result, "done");
  assert.deepEqual(database.transactions, ["begin", "commit"]);
  assert.equal(database.queries.length, 2);
  assert.equal(database.queries[0]?.inputs.takenCode0, "0001-0002-0003");

  const failing = createFakeDatabase((sql) => {
    if (sql.includes("UPDLOCK")) return { recordsets: profileSets };
    throw Object.assign(new Error("duplicate key"), { number: 2601 });
  });
  await assert.rejects(
    createSqlProfileStore(failing).saveProfile(223, [], () => ({
      plan: { country: "us", deletes: [], updates: [], inserts: [] },
      audit: "{}",
      result: "done",
    })),
    /duplicate key/,
  );
  assert.deepEqual(failing.transactions, ["begin", "rollback"]);
});

test("countries come from dbo.Enumeration in lower case and are read once an hour", async () => {
  const database = createFakeDatabase(() => ({
    recordset: [
      { Code: "DE", Description: "Germany " },
      { Code: "", Description: "nothing" },
    ],
  }));
  const store = createSqlProfileStore(database);
  assert.deepEqual(await store.countries(), [{ code: "de", name: "Germany" }]);
  await store.countries();
  assert.equal(database.queries.length, 1);
});
