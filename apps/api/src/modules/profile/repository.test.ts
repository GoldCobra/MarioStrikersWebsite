import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDatabase } from "../../test-support/fake-database.ts";
import { buildEnsurePlayerQuery, createSqlProfileStore, isUniqueViolation } from "./repository.ts";

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
