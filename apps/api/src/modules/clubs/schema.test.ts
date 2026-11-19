import assert from "node:assert/strict";
import test from "node:test";
import { CLUB_PUBLIC_ID_ALPHABET, isClubPublicId } from "@ms/shared/clubs";
import { createFakeDatabase, type QueryResult } from "../../test-support/fake-database.ts";
import {
  CLEANUP_LOG_COMMAND,
  CLUBS_WITHOUT_PUBLIC_ID_QUERY,
  CLUB_COLUMNS,
  CLUB_COLUMNS_SQL,
  CLUB_TABLES,
  CLUB_TABLES_SQL,
  DUPLICATE_NAMES_QUERY,
  NAME_INDEX_SQL,
  NEW_VALUES_QUERY,
  PUBLIC_IDS_QUERY,
  PUBLIC_ID_FINISH_SQL,
  ROSTER_COLUMNS,
  ROSTER_COLUMNS_SQL,
  SCHEMA_STATE_QUERY,
  SESSION_SQL,
  applyClubSchema,
  backupClubTables,
  backupTableName,
  deleteEmptyClubs,
  dropClubBackups,
  publicIdDefaultSql,
  utcStamp,
} from "./schema.ts";
import { generateClubPublicId } from "./rules.ts";

const STAMP = "20261119";

/** A database that keeps the schema state the statements change, enough to run every step. */
function simulatedDatabase(
  options: { duplicateNames?: string[]; changeClubValues?: boolean; clubIds?: number[] } = {},
) {
  const clubIds = options.clubIds ?? [2, 4, 7];
  const state = {
    columns: new Set<string>(),
    tables: new Set<string>(),
    indexes: new Set<string>(),
    backups: new Set<string>(),
    publicIds: new Map<number, string>(),
    fingerprint: 1234,
  };
  const db = createFakeDatabase((sql, inputs): QueryResult => {
    if (sql === SESSION_SQL) return {};
    if (sql === SCHEMA_STATE_QUERY) {
      return {
        recordsets: [
          [...state.columns].map((name) => ({ name })),
          [...state.tables].map((name) => ({ name })),
          [...state.indexes].map((name) => ({ name })),
          [{ clubs: clubIds.length, roster_rows: 9, club_fingerprint: state.fingerprint, roster_fingerprint: 77 }],
        ],
      };
    }
    if (sql.startsWith("SELECT OBJECT_ID(@name")) {
      const name = String(inputs.name).replace(/^dbo\./, "");
      return { recordset: [{ id: state.backups.has(name) || state.tables.has(name) ? 1 : null }] };
    }
    if (sql === CLUB_COLUMNS_SQL) {
      for (const column of CLUB_COLUMNS) state.columns.add(`Club.${column}`);
      if (options.changeClubValues) state.fingerprint += 1;
      return {};
    }
    if (sql === ROSTER_COLUMNS_SQL) {
      for (const column of ROSTER_COLUMNS) state.columns.add(`ClubRoster.${column}`);
      return {};
    }
    if (sql === CLUB_TABLES_SQL) {
      for (const table of CLUB_TABLES) state.tables.add(table);
      return {};
    }
    if (sql === CLUBS_WITHOUT_PUBLIC_ID_QUERY) {
      return { recordset: clubIds.filter((id) => !state.publicIds.has(id)).map((ID) => ({ ID })) };
    }
    if (sql === PUBLIC_IDS_QUERY) return { recordset: [...state.publicIds.values()].map((PublicId) => ({ PublicId })) };
    if (sql.startsWith("UPDATE c SET PublicId")) {
      let index = 0;
      while (inputs[`club${index}`] !== undefined) {
        state.publicIds.set(Number(inputs[`club${index}`]), String(inputs[`id${index}`]));
        index += 1;
      }
      return { rowsAffected: [index] };
    }
    if (sql === PUBLIC_ID_FINISH_SQL) {
      state.indexes.add("UX_Club_PublicId");
      return {};
    }
    if (sql === DUPLICATE_NAMES_QUERY) {
      return { recordset: (options.duplicateNames ?? []).map((name) => ({ name, clubs: 2 })) };
    }
    if (sql === NAME_INDEX_SQL) {
      state.indexes.add("UX_Club_ClubName");
      return {};
    }
    if (sql === NEW_VALUES_QUERY) {
      const ids = [...state.publicIds.values()];
      return {
        recordset: [
          {
            without_public_id: clubIds.length - state.publicIds.size,
            invalid_public_ids: ids.filter((id) => !isClubPublicId(id)).length,
            distinct_public_ids: new Set(ids).size,
            not_established: 0,
            roster_rows_with_new_values: 0,
            state_rows: 1,
            mode: "off",
          },
        ],
      };
    }
    throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
  });
  return { db, state };
}

test("club ids are eight characters of the alphabet, drawn at random", () => {
  let next = 0;
  assert.equal(
    generateClubPublicId(() => next++),
    CLUB_PUBLIC_ID_ALPHABET.slice(0, 8),
  );
  for (let round = 0; round < 50; round += 1) assert.equal(isClubPublicId(generateClubPublicId()), true);
  const sql = publicIdDefaultSql();
  assert.equal(sql.match(/NEWID\(\)/g)?.length, 8);
  assert.equal(sql.match(new RegExp(`'${CLUB_PUBLIC_ID_ALPHABET}'`, "g"))?.length, 8);
  assert.match(sql, /% 57, 1\)/);
});

test("a dry run makes the whole change in the transaction, checks it and rolls it back", async () => {
  const { db } = simulatedDatabase();
  const report = await applyClubSchema(db, { apply: false, stamp: STAMP });
  assert.deepEqual(db.transactions, ["begin", "rollback"]);
  assert.equal(report.applied, false);
  assert.equal(report.status, "dry run, rolled back");
  assert.equal(report.addedColumns.length, CLUB_COLUMNS.length + ROSTER_COLUMNS.length);
  assert.deepEqual(report.createdTables, [...CLUB_TABLES]);
  assert.deepEqual(report.createdIndexes, ["UX_Club_PublicId", "UX_Club_ClubName"]);
  assert.equal(report.publicIdsAssigned, 3);
  assert.deepEqual(report.duplicateNames, []);
  const order = db.queries.map((query) => query.sql);
  for (const [earlier, later] of [
    [CLUB_COLUMNS_SQL, CLUB_TABLES_SQL],
    [CLUB_TABLES_SQL, CLUBS_WITHOUT_PUBLIC_ID_QUERY],
    [CLUBS_WITHOUT_PUBLIC_ID_QUERY, PUBLIC_ID_FINISH_SQL],
    [PUBLIC_ID_FINISH_SQL, NAME_INDEX_SQL],
  ] as const) {
    assert.ok(order.indexOf(earlier) < order.indexOf(later), `${earlier.slice(0, 30)} before ${later.slice(0, 30)}`);
  }
});

test("--apply needs the backup tables of the day and then commits", async () => {
  const refused = simulatedDatabase();
  await assert.rejects(applyClubSchema(refused.db, { apply: true, stamp: STAMP }), /Back up first/);
  assert.deepEqual(refused.db.transactions, ["begin", "rollback"]);
  assert.equal(
    refused.db.queries.some((query) => query.sql === CLUB_COLUMNS_SQL),
    false,
    "nothing is changed",
  );

  const { db, state } = simulatedDatabase();
  for (const table of ["Club", "ClubRoster", "_PlayerLobby"] as const) state.backups.add(backupTableName(table, STAMP));
  const report = await applyClubSchema(db, { apply: true, stamp: STAMP });
  assert.deepEqual(db.transactions, ["begin", "commit"]);
  assert.equal(report.applied, true);
  assert.equal(report.status, "applied");
  assert.equal(state.publicIds.size, 3);

  // Run again: everything is there, nothing changes.
  const again = await applyClubSchema(db, { apply: true, stamp: "20991231" });
  assert.equal(again.status, "nothing to change");
  assert.equal(again.applied, false);
});

test("a name that exists twice keeps the name index away and is reported", async () => {
  const { db } = simulatedDatabase({ duplicateNames: ["Hammer Bros"] });
  const report = await applyClubSchema(db, { apply: false, stamp: STAMP });
  assert.deepEqual(report.duplicateNames, ["Hammer Bros"]);
  assert.deepEqual(report.createdIndexes, ["UX_Club_PublicId"]);
  assert.equal(
    db.queries.some((query) => query.sql === NAME_INDEX_SQL),
    false,
  );
});

test("a change to an existing value fails the check and rolls everything back", async () => {
  const { db } = simulatedDatabase({ changeClubValues: true });
  await assert.rejects(applyClubSchema(db, { apply: false, stamp: STAMP }), /existing club values changed/);
  assert.deepEqual(db.transactions, ["begin", "rollback"]);
});

test("a club id that exists already is drawn again", async () => {
  // Club 9 has its id already (a club the bot created after the column existed).
  const { db, state } = simulatedDatabase({ clubIds: [2, 4, 9] });
  state.columns.add("Club.PublicId");
  state.publicIds.set(9, "AAAAAAAA");
  const drawn = ["AAAAAAAA", "BBBBBBBB", "AAAAAAAA", "CCCCCCCC"];
  await applyClubSchema(db, { apply: false, stamp: STAMP, generate: () => drawn.shift() ?? "DDDDDDDD" });
  assert.deepEqual([state.publicIds.get(2), state.publicIds.get(4)], ["BBBBBBBB", "CCCCCCCC"]);
});

test("backups copy the three club tables once and are dropped by stamp", async () => {
  const copied: string[] = [];
  const existing = new Set<string>();
  const db = createFakeDatabase((sql, inputs) => {
    if (sql.startsWith("SELECT OBJECT_ID(@name")) {
      return { recordset: [{ id: existing.has(String(inputs.name)) ? 1 : null }] };
    }
    const into = /^SELECT \* INTO (\S+) FROM/.exec(sql);
    if (into?.[1]) {
      copied.push(into[1]);
      existing.add(into[1]);
      return {};
    }
    if (sql.startsWith("SELECT (SELECT COUNT(*)")) return { recordset: [{ source_rows: 5, backup_rows: 5 }] };
    if (sql.startsWith("DROP TABLE ")) {
      existing.delete(sql.slice("DROP TABLE ".length, -1));
      return {};
    }
    return {};
  });
  const report = await backupClubTables(db, STAMP);
  assert.deepEqual(copied, [
    "dbo.Club_Backup_20261119",
    "dbo.ClubRoster_Backup_20261119",
    "dbo._PlayerLobby_Backup_20261119",
  ]);
  assert.deepEqual(
    report.created.map((entry) => entry.rows),
    [5, 5, 5],
  );
  await assert.rejects(backupClubTables(db, STAMP), /exists already/);
  assert.deepEqual((await dropClubBackups(db, STAMP)).dropped, copied);
  assert.deepEqual((await dropClubBackups(db, STAMP)).dropped, []);
  assert.throws(() => backupTableName("Club", "2026-11-19"), /Invalid backup stamp/);
  assert.equal(utcStamp(new Date("2026-11-19T23:59:59Z")), "20261119");
});

/** A database with three clubs for E1: 3 and 373 empty, 4 with a member; the backup holds 3, 4 and 373. */
function cleanupDatabase(options: { backup?: boolean; deletedRows?: number } = {}) {
  const clubs = [
    {
      ID: 3,
      PublicId: "Ab3dEf9h",
      ClanTag: "GLG",
      ClubName: "Gold Leaf Galaxy",
      Owner: "424998135505616907",
      members: 0,
    },
    { ID: 4, PublicId: "Zz8xWv7u", ClanTag: "RL", ClubName: "Rocket League", Owner: "1", members: 11 },
    {
      ID: 373,
      PublicId: "Kq2mNp4r",
      ClanTag: "AAP",
      ClubName: "Aalborg Pirates",
      Owner: "414167100219981845",
      members: 0,
    },
  ];
  return createFakeDatabase((sql, inputs) => {
    if (sql === SESSION_SQL) return {};
    if (sql.startsWith("SELECT OBJECT_ID(@name")) return { recordset: [{ id: options.backup === false ? null : 1 }] };
    if (sql.startsWith("SELECT c.ID, c.PublicId")) {
      const wanted = Object.values(inputs).map(Number);
      return { recordset: clubs.filter((club) => wanted.includes(club.ID)).map((club) => ({ ...club, backed_up: 1 })) };
    }
    if (sql.startsWith("IF OBJECT_ID(N'dbo.")) return { rowsAffected: sql.includes("_PlayerLobby") ? [0] : [] };
    if (sql.startsWith("DELETE FROM dbo.Club WHERE ID IN")) {
      const count = Object.keys(inputs).filter((key) => key.startsWith("club")).length;
      return { rowsAffected: [options.deletedRows ?? count, count] };
    }
    throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
  });
}

test("E1 deletes exactly the listed empty clubs, with a log row each", async () => {
  const dry = cleanupDatabase();
  const preview = await deleteEmptyClubs(dry, { ids: [3, 373], apply: false, stamp: STAMP });
  assert.deepEqual(dry.transactions, ["begin", "rollback"]);
  assert.equal(preview.applied, false);
  assert.match(preview.status, /^dry run, rolled back: would delete 2 club\(s\)$/);
  assert.deepEqual(
    preview.deleted.map((club) => club.tag),
    ["GLG", "AAP"],
  );

  const db = cleanupDatabase();
  const report = await deleteEmptyClubs(db, { ids: [3, 373, 3], apply: true, stamp: STAMP });
  assert.deepEqual(db.transactions, ["begin", "commit"]);
  assert.equal(report.status, "deleted 2 club(s)");
  const remove = db.queries.find((query) => query.sql.startsWith("DELETE FROM dbo.Club WHERE ID IN"));
  assert.ok(remove);
  assert.match(
    remove.sql,
    new RegExp(`INSERT INTO dbo.CommandLog \\(Command, Parameters\\) VALUES \\(N'${CLEANUP_LOG_COMMAND}'`),
  );
  assert.deepEqual(JSON.parse(String(remove.inputs.log0)), {
    club_id: 3,
    public_id: "Ab3dEf9h",
    tag: "GLG",
    name: "Gold Leaf Galaxy",
    owner_discord_id: "424998135505616907",
    reason: "E1: no members",
    source: "ops:club-cleanup",
  });
  const attachments = db.queries.filter((query) => query.sql.startsWith("IF OBJECT_ID(N'dbo."));
  assert.deepEqual(
    attachments.map((query) => /DELETE FROM dbo\.(\S+)/.exec(query.sql)?.[1]),
    ["_PlayerLobby", "ClubInvitation", "ClubJoinBlock", "ClubLogo"],
  );
});

test("E1 refuses the whole list for a missing club, a club with members or a missing backup", async () => {
  for (const [ids, pattern] of [
    [[3, 999], /club 999 does not exist/],
    [[3, 4], /club 4 has 11 member\(s\)/],
  ] as const) {
    const db = cleanupDatabase();
    await assert.rejects(deleteEmptyClubs(db, { ids, apply: true, stamp: STAMP }), pattern);
    assert.deepEqual(db.transactions, ["begin", "rollback"]);
    assert.equal(
      db.queries.some((query) => query.sql.startsWith("DELETE")),
      false,
    );
  }
  await assert.rejects(
    deleteEmptyClubs(cleanupDatabase({ backup: false }), { ids: [3], apply: true, stamp: STAMP }),
    /No backup table/,
  );
  await assert.rejects(
    deleteEmptyClubs(cleanupDatabase({ deletedRows: 1 }), { ids: [3, 373], apply: true, stamp: STAMP }),
    /Expected 2 clubs and log rows, got 1 and 2/,
  );
  await assert.rejects(
    deleteEmptyClubs(cleanupDatabase(), { ids: [], apply: false, stamp: STAMP }),
    /List the club ids/,
  );
});
