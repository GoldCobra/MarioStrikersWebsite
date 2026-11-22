import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDatabase, type RecordedStatement } from "../../test-support/fake-database.ts";
import { isUniqueViolation } from "../../lib/sql-errors.ts";
import { seededCatalog } from "../titles/catalog.ts";
import { createSqlProfileStore } from "./repository.ts";
import type { ChangePlan } from "./service.ts";

const DISCORD_ID = "709777875686916210";
const NO_TITLES = { get: () => Promise.resolve([]) };
const TITLES = seededCatalog();
const titleId = (code: string): number => TITLES.find((title) => title.code === code)?.id ?? 0;

/** The five result sets of the profile batch: a player from Germany with one Switch code. */
const PROFILE_SETS = [
  [{ country: "de" }],
  [{ GameType: 3, Region: "SW", LineSeq: 1, Label: "", Code: "0012-0000-0340" }],
  [],
  [],
  [],
];

/** A statement's text on one line, as the assertions read it. */
const flat = (text = ""): string => text.replace(/\s+/g, " ").trim();

function duplicateKeyError(): Error {
  return Object.assign(new Error("Cannot insert duplicate key row in object 'dbo.Player'."), { number: 2601 });
}

/** The batch a save of `plan` writes after reading the profile under update locks. */
async function writtenBatch(plan: ChangePlan): Promise<RecordedStatement> {
  const database = createFakeDatabase(({ text }) => (text.includes("UPDLOCK") ? { sets: PROFILE_SETS } : undefined));
  await createSqlProfileStore(database, NO_TITLES).saveProfile(223, [], () => ({ plan, audit: "{}", result: "done" }));
  assert.equal(database.statements.length, 2);
  const [, written] = database.statements;
  return { text: flat(written?.text), values: written?.values ?? [] };
}

test("the profile is created in one locked batch and logged like the bot's procedures", async () => {
  const database = createFakeDatabase(() => [{ player_id: 1124, created: true }]);
  await createSqlProfileStore(database, NO_TITLES).ensurePlayer(DISCORD_ID, "GoldCobra");
  const text = flat(database.statements[0]?.text);
  // No SET in the batch: a session setting stays on the pooled connection (NOCOUNT would empty its rowsAffected).
  assert.match(text, /^BEGIN TRANSACTION; DECLARE @discordId NVARCHAR\(25\) = @p0;/);
  assert.match(text, /FROM dbo\.Player WITH \(UPDLOCK, HOLDLOCK\) WHERE DiscordID = @discordId/);
  assert.match(text, /INSERT INTO dbo\.Player \(Name, DiscordID\) VALUES \(@p1, @discordId\);/);
  assert.match(text, /SET @playerId = CONVERT\(INT, SCOPE_IDENTITY\(\)\);/);
  assert.match(text, /INSERT INTO dbo\.CommandLog \(Command, Parameters\) VALUES \(N'WebsiteCreatePlayer', @p2\);/);
  assert.match(text, /COMMIT TRANSACTION; SELECT @playerId AS player_id, @created AS created;$/);
});

test("ensurePlayer returns the created or reused player with typed parameters", async () => {
  const database = createFakeDatabase(() => [{ player_id: 1124, created: true }]);
  const store = createSqlProfileStore(database, NO_TITLES);
  assert.deepEqual(await store.ensurePlayer(DISCORD_ID, "GoldCobra"), { playerId: 1124, created: true });
  const [statement] = database.statements;
  assert.equal(statement?.values.length, 3, "the Discord id is sent once");
  assert.deepEqual(statement.values.slice(0, 2), [DISCORD_ID, "GoldCobra"]);
  assert.deepEqual(JSON.parse(String(statement.values[2])), {
    discord_id: DISCORD_ID,
    name: "GoldCobra",
    source: "website login",
  });

  const reused = createSqlProfileStore(
    createFakeDatabase(() => [{ player_id: 223, created: false }]),
    NO_TITLES,
  );
  assert.deepEqual(await reused.ensurePlayer(DISCORD_ID, "GoldCobra"), { playerId: 223, created: false });
});

test("a parallel insert of the same Discord id is answered with that row", async () => {
  let calls = 0;
  const database = createFakeDatabase(() => {
    calls += 1;
    if (calls === 1) throw duplicateKeyError();
    return [{ player_id: 223, created: false }];
  });
  assert.deepEqual(await createSqlProfileStore(database, NO_TITLES).ensurePlayer(DISCORD_ID, "GoldCobra"), {
    playerId: 223,
    created: false,
  });
  assert.equal(database.statements.length, 2);
});

test("other database errors and empty answers are reported", async () => {
  const failing = createFakeDatabase(() => {
    throw new Error("Connection is closed.");
  });
  await assert.rejects(
    createSqlProfileStore(failing, NO_TITLES).ensurePlayer(DISCORD_ID, "GoldCobra"),
    /Connection is closed/,
  );
  const empty = createFakeDatabase(() => []);
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

test("the editor reads the profile, under update locks when it saves", async () => {
  const database = createFakeDatabase(({ text }) =>
    text.includes("SELECT p.Country") ? { sets: PROFILE_SETS } : undefined,
  );
  const store = createSqlProfileStore(database, NO_TITLES);
  const unchanged = () => ({ plan: null, audit: "", result: "unchanged" });
  await store.readProfile(223);
  await store.saveProfile(223, [], unchanged);
  await store.saveProfile(
    223,
    [
      { gameType: 3, code: "0001-0002-0003" },
      { gameType: 1, code: "0004-0005-0006" },
    ],
    unchanged,
  );
  const [read, locked, withTaken] = database.statements.map((statement) => ({
    text: flat(statement.text),
    values: statement.values,
  }));
  assert.ok(read && locked && withTaken);

  assert.doesNotMatch(read.text, /UPDLOCK/);
  assert.deepEqual(read.values, [223]);
  assert.match(locked.text, /^DECLARE @playerId INT = @p0;/);
  assert.match(locked.text, /FROM dbo\.Player p WITH \(UPDLOCK, HOLDLOCK\) WHERE p\.ID = @playerId;/);
  assert.match(locked.text, /FROM dbo\.FriendCodes fc WITH \(UPDLOCK, HOLDLOCK\) WHERE fc\.Player = @playerId/);
  assert.match(
    locked.text,
    /SELECT a\.TitleId FROM dbo\.PlayerActiveTitle a WITH \(UPDLOCK, HOLDLOCK\) WHERE a\.PlayerId = @playerId;/,
  );
  // Without codes to check, the batch ends with the unlocks, read without locks.
  assert.match(
    locked.text,
    /SELECT u\.TitleId FROM dbo\.PlayerTitleUnlock u WHERE u\.PlayerId = @playerId; SELECT x\.TitleId FROM dbo\.PlayerTitleTestUnlock x WHERE x\.PlayerId = @playerId;$/,
  );
  assert.deepEqual(locked.values, [223]);
  assert.ok(
    withTaken.text.endsWith(
      "SELECT fc.GameType, fc.Code FROM dbo.FriendCodes fc WHERE fc.Player <> @playerId AND " +
        "((fc.GameType = @p1 AND fc.Code = @p2) OR (fc.GameType = @p3 AND fc.Code = @p4));",
    ),
  );
  assert.deepEqual(withTaken.values, [223, 3, "0001-0002-0003", 1, "0004-0005-0006"]);
});

test("a plan becomes deletes, ascending updates, inserts and the audit row, all parameterised", async () => {
  const row = (lineSeq: number, code: string) => ({ gameType: 1, region: "PAL", lineSeq, label: "Wii", code });
  const { text, values } = await writtenBatch({
    country: "us",
    title: null,
    deletes: [row(1, "1111-1111-1111")],
    updates: [{ row: row(2, "2222-2222-2222"), label: "Recharged", lineSeq: 1 }],
    inserts: [{ gameType: 3, region: "SW", lineSeq: 1, label: "", code: "0001-0002-0003" }],
  });
  const statements = text.split(/;\s*/).filter(Boolean);
  assert.deepEqual(
    statements.map((statement) => statement.split(" ").slice(0, 2).join(" ")),
    ["DECLARE @playerId", "UPDATE dbo.Player", "DELETE FROM", "UPDATE dbo.FriendCodes", "INSERT INTO", "INSERT INTO"],
  );
  assert.match(
    text,
    /DELETE FROM dbo\.FriendCodes WHERE Player = @playerId AND GameType = @p2 AND Region = @p3 AND LineSeq = @p4;/,
  );
  // A kept row is found by its old LineSeq and gets the new one.
  assert.match(
    text,
    /UPDATE dbo\.FriendCodes SET Label = @p5, LineSeq = @p6 WHERE Player = @playerId AND GameType = @p7 AND Region = @p8 AND LineSeq = @p9;/,
  );
  assert.match(text, /INSERT INTO dbo\.CommandLog \(Command, Parameters\) VALUES \(N'WebsiteProfileSave', @p15\);$/);
  assert.deepEqual(values, [
    223,
    "us",
    1,
    "PAL",
    1,
    "Recharged",
    1,
    1,
    "PAL",
    2,
    3,
    1,
    "SW",
    "",
    "0001-0002-0003",
    "{}",
  ]);
  assert.doesNotMatch(text, /0001-0002-0003|Recharged/);
});

test("a save reads, decides and writes in one transaction; a failure rolls it back", async () => {
  const database = createFakeDatabase(({ text }) => (text.includes("UPDLOCK") ? { sets: PROFILE_SETS } : undefined));
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
  assert.equal(database.statements.length, 2);
  assert.deepEqual(database.statements[0]?.values, [223, 3, "0001-0002-0003"]);

  const failing = createFakeDatabase(({ text }) => {
    if (text.includes("UPDLOCK")) return { sets: PROFILE_SETS };
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
  const database = createFakeDatabase(() => [
    { Code: "DE", Description: "Germany " },
    { Code: "", Description: "nothing" },
  ]);
  const store = createSqlProfileStore(database, NO_TITLES);
  assert.deepEqual(await store.countries(), [{ code: "de", name: "Germany" }]);
  await store.countries();
  assert.equal(database.statements.length, 1);
  assert.match(flat(database.statements[0]?.text), /FROM dbo\.Enumeration WHERE Type = N'country';/);
});

test("a title change replaces the selected title; none removes it; the code is a parameter", async () => {
  const plan = { country: null, deletes: [], updates: [], inserts: [] };
  const set = await writtenBatch({ ...plan, title: "og-player" });
  assert.match(
    set.text,
    /DELETE FROM dbo\.PlayerActiveTitle WHERE PlayerId = @playerId; INSERT INTO dbo\.PlayerActiveTitle \(PlayerId, TitleId\) SELECT @playerId, t\.Id FROM dbo\.PlayerTitle t WHERE t\.Code = @p1;/,
  );
  assert.equal(set.values[1], "og-player");
  assert.doesNotMatch(set.text, /og-player/);
  const removed = await writtenBatch({ ...plan, title: "" });
  assert.match(removed.text, /DELETE FROM dbo\.PlayerActiveTitle WHERE PlayerId = @playerId;/);
  assert.doesNotMatch(removed.text, /INSERT INTO dbo\.PlayerActiveTitle/);
  assert.doesNotMatch((await writtenBatch({ ...plan, title: null, country: "de" })).text, /PlayerActiveTitle/);
});

test("the stored profile has the selected title only while the player can select it", async () => {
  const sets = (selected: string, unlocked: readonly string[], tests: readonly string[] = []) => [
    [{ country: "" }],
    [],
    selected ? [{ TitleId: titleId(selected) }] : [],
    unlocked.map((code) => ({ TitleId: titleId(code) })),
    tests.map((code) => ({ TitleId: titleId(code) })),
  ];
  const read = async (selected: string, unlocked: readonly string[], tests: readonly string[] = []) =>
    createSqlProfileStore(
      createFakeDatabase(() => ({ sets: sets(selected, unlocked, tests) })),
      {
        get: () => Promise.resolve(TITLES),
      },
    ).readProfile(223);

  const champion = await read("msl-3-time-world-champion-msc", [
    "msl-3-time-world-champion-msc",
    "legacy-rookie",
    "legacy-legend",
  ]);
  assert.equal(champion.title, "msl-3-time-world-champion-msc");
  const codes = champion.titles.map((title) => title.code);
  assert.deepEqual(codes.slice(0, 2), ["msl-3-time-world-champion-msc", "legacy-legend"]);
  assert.ok(codes.includes("og-player"));
  assert.ok(!codes.includes("legacy-rookie"), "only the highest legacy rank is offered");
  assert.deepEqual(champion.titles[0], {
    code: "msl-3-time-world-champion-msc",
    name: "3-TIME WORLD CHAMPION",
    category: "msl",
    categoryName: "MSL Titles",
    style: "msl-world",
    gameCode: "MSC",
  });
  // Test unlocks (player 223) add titles on top, also another player's fixed one; regular ones stay as they are.
  const tester = await read(
    "wfc-5012-daily-points-world-record",
    ["legacy-rookie"],
    ["wfc-5012-daily-points-world-record"],
  );
  assert.equal(tester.title, "wfc-5012-daily-points-world-record");
  assert.ok(tester.titles.some((title) => title.code === "legacy-rookie"));

  assert.equal((await read("og-player", [])).title, "og-player");
  assert.equal(
    (await read("msl-2023-world-champion", ["msl-2023-world-champion"])).title,
    "",
    "a template is never selected",
  );
  assert.equal((await read("tournament-winner-sms", [])).title, "", "a title no longer unlocked is not selected");
  assert.equal((await read("legacy-rookie", ["legacy-rookie", "legacy-legend"])).title, "");
});
