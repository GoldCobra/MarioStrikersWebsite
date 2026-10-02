import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDatabase } from "../../test-support/fake-database.ts";
import { isUniqueViolation } from "../../lib/sql-errors.ts";
import { seededCatalog } from "../titles/catalog.ts";
import {
  buildApplyQuery,
  buildEnsurePlayerQuery,
  buildProfileQuery,
  buildTakenCodesQuery,
  createSqlProfileStore,
} from "./repository.ts";

const DISCORD_ID = "709777875686916210";
const NO_TITLES = { get: () => Promise.resolve([]) };
const TITLES = seededCatalog();
const titleId = (code: string): number => TITLES.find((title) => title.code === code)?.id ?? 0;

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
  const store = createSqlProfileStore(database, NO_TITLES);
  assert.deepEqual(await store.ensurePlayer(DISCORD_ID, "GoldCobra"), { playerId: 1124, created: true });
  const [query] = database.queries;
  assert.equal(query?.inputs.discordId, DISCORD_ID);
  assert.equal(query.inputs.name, "GoldCobra");
  assert.deepEqual(JSON.parse(String(query.inputs.logParameters)), {
    discord_id: DISCORD_ID,
    name: "GoldCobra",
    source: "website login",
  });

  const reused = createSqlProfileStore(
    createFakeDatabase(() => ({ recordset: [{ player_id: 223, created: false }] })),
    NO_TITLES,
  );
  assert.deepEqual(await reused.ensurePlayer(DISCORD_ID, "GoldCobra"), { playerId: 223, created: false });
});

test("a parallel insert of the same Discord id is answered with that row", async () => {
  let calls = 0;
  const database = createFakeDatabase(() => {
    calls += 1;
    if (calls === 1) throw duplicateKeyError();
    return { recordset: [{ player_id: 223, created: 0 }] };
  });
  assert.deepEqual(await createSqlProfileStore(database, NO_TITLES).ensurePlayer(DISCORD_ID, "GoldCobra"), {
    playerId: 223,
    created: false,
  });
  assert.equal(database.queries.length, 2);
});

test("other database errors and empty answers are reported", async () => {
  const failing = createFakeDatabase(() => {
    throw new Error("Connection is closed.");
  });
  await assert.rejects(
    createSqlProfileStore(failing, NO_TITLES).ensurePlayer(DISCORD_ID, "GoldCobra"),
    /Connection is closed/,
  );
  const empty = createFakeDatabase(() => ({ recordset: [] }));
  await assert.rejects(
    createSqlProfileStore(empty, NO_TITLES).ensurePlayer(DISCORD_ID, "GoldCobra"),
    /could not be created/,
  );
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
  assert.match(
    locked,
    /SELECT a\.TitleId FROM dbo\.PlayerActiveTitle a WITH \(UPDLOCK, HOLDLOCK\) WHERE a\.PlayerId = @playerId;/,
  );
  assert.match(locked, /SELECT u\.TitleId FROM dbo\.PlayerTitleUnlock u WHERE u\.PlayerId = @playerId;$/);
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
      title: null,
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
    [],
    [],
  ];
  const database = createFakeDatabase((sql) =>
    sql.includes("UPDLOCK") ? { recordsets: profileSets } : { recordset: [] },
  );
  const store = createSqlProfileStore(database, NO_TITLES);
  const result = await store.saveProfile(223, [{ gameType: 3, code: "0001-0002-0003" }], (current, taken) => {
    assert.deepEqual(current, {
      playerId: 223,
      country: "de",
      codes: [{ gameType: 3, region: "SW", lineSeq: 1, label: "", code: "0012-0000-0340" }],
      title: "",
      titles: [],
    });
    assert.deepEqual(taken, []);
    return {
      plan: { country: "us", title: null, deletes: [], updates: [], inserts: [] },
      audit: "{}",
      result: "done",
    };
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
    createSqlProfileStore(failing, NO_TITLES).saveProfile(223, [], () => ({
      plan: { country: "us", title: null, deletes: [], updates: [], inserts: [] },
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
  const store = createSqlProfileStore(database, NO_TITLES);
  assert.deepEqual(await store.countries(), [{ code: "de", name: "Germany" }]);
  await store.countries();
  assert.equal(database.queries.length, 1);
});

test("a title change replaces the selected title; none removes it; the code is a parameter", () => {
  const inputs: Record<string, unknown> = {};
  const request = {
    input(name: string, _type: unknown, value: unknown) {
      inputs[name] = value;
      return request;
    },
  } as unknown as Parameters<typeof buildApplyQuery>[1];
  const plan = { country: null, deletes: [], updates: [], inserts: [] };
  const set = buildApplyQuery({ ...plan, title: "og-player" }, request);
  assert.match(
    set,
    /DELETE FROM dbo\.PlayerActiveTitle WHERE PlayerId = @playerId; INSERT INTO dbo\.PlayerActiveTitle \(PlayerId, TitleId\) SELECT @playerId, t\.Id FROM dbo\.PlayerTitle t WHERE t\.Code = @titleCode;/,
  );
  assert.equal(inputs.titleCode, "og-player");
  assert.doesNotMatch(set, /og-player/);
  const removed = buildApplyQuery({ ...plan, title: "" }, request);
  assert.match(removed, /DELETE FROM dbo\.PlayerActiveTitle WHERE PlayerId = @playerId;/);
  assert.doesNotMatch(removed, /INSERT INTO dbo\.PlayerActiveTitle/);
  assert.doesNotMatch(buildApplyQuery({ ...plan, title: null, country: "de" }, request), /PlayerActiveTitle/);
});

test("the stored profile has the selected title only while the player can select it", async () => {
  const sets = (selected: string, unlocked: readonly string[]) => [
    [{ country: "" }],
    [],
    selected ? [{ TitleId: titleId(selected) }] : [],
    unlocked.map((code) => ({ TitleId: titleId(code) })),
  ];
  const read = async (selected: string, unlocked: readonly string[]) =>
    createSqlProfileStore(
      createFakeDatabase(() => ({ recordsets: sets(selected, unlocked) })),
      {
        get: () => Promise.resolve(TITLES),
      },
    ).readProfile(223);

  const champion = await read("msl-2023-world-champion", ["msl-2023-world-champion", "legacy-rookie", "legacy-legend"]);
  assert.equal(champion.title, "msl-2023-world-champion");
  const codes = champion.titles.map((title) => title.code);
  assert.deepEqual(codes.slice(0, 2), ["msl-2023-world-champion", "legacy-legend"]);
  assert.ok(codes.includes("og-player"));
  assert.ok(!codes.includes("legacy-rookie"), "only the highest legacy rank is offered");
  assert.deepEqual(champion.titles[0], {
    code: "msl-2023-world-champion",
    name: "MSL 2023 WORLD CHAMPION",
    category: "msl",
    categoryName: "MSL Titles",
    style: "",
  });

  assert.equal((await read("og-player", [])).title, "og-player");
  assert.equal((await read("msl-2023-world-champion", [])).title, "", "a title no longer unlocked is not selected");
  assert.equal((await read("legacy-rookie", ["legacy-rookie", "legacy-legend"])).title, "");
});
