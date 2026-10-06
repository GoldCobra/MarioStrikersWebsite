import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDatabase } from "../../test-support/fake-database.ts";
import { createMemoryAdminAuditStore } from "./audit.ts";
import {
  AUDIT_SCHEMA_SQL,
  AUDIT_SCHEMA_STATE_QUERY,
  RECENT_QUERY,
  RECORD_QUERY,
  applyAdminAuditSchema,
  createSqlAdminAuditStore,
} from "./audit-repository.ts";

test("records are written with clipped values and prune old rows once a day", async () => {
  const db = createFakeDatabase(() => ({ recordset: [] }));
  const clock = { now: 1_800_000_000_000 };
  const store = createSqlAdminAuditStore(db, () => clock.now);
  await store.record({
    discordUserId: "195905866527014912",
    action: "page.open",
    outcome: "allowed",
    ip: "2001:db8::1",
    requestId: "req-1",
    target: "x".repeat(300),
  });
  await store.record({ discordUserId: "195905866527014912", action: "page.open", outcome: "allowed" });
  clock.now += 24 * 60 * 60 * 1000;
  await store.record({ discordUserId: "195905866527014912", action: "page.open", outcome: "denied" });

  assert.deepEqual(
    db.queries.map((query) => query.sql),
    [RECORD_QUERY, RECORD_QUERY, RECORD_QUERY],
  );
  const [first, second, third] = db.queries.map((query) => query.inputs);
  assert.deepEqual(first, {
    discordUserId: "195905866527014912",
    action: "page.open",
    target: "x".repeat(200),
    outcome: "allowed",
    ip: "2001:db8::1",
    requestId: "req-1",
    details: null,
    prune: true,
  });
  assert.equal(second?.prune, false);
  assert.equal(second.ip, null);
  assert.equal(third?.prune, true);
  assert.match(RECORD_QUERY, /DATEADD\(DAY, -180, SYSUTCDATETIME\(\)\)/);
});

test("the newest entries are read first, without addresses", async () => {
  const db = createFakeDatabase(() => ({
    recordset: [
      {
        AtUtc: new Date("2026-10-06T10:00:00Z"),
        DiscordUserId: "1",
        Action: "page.open",
        Target: null,
        Outcome: "allowed",
      },
    ],
  }));
  assert.deepEqual(await createSqlAdminAuditStore(db).recent(50), [
    { at: "2026-10-06T10:00:00.000Z", discordUserId: "1", action: "page.open", target: "", outcome: "allowed" },
  ]);
  assert.equal(db.queries[0]?.sql, RECENT_QUERY);
  assert.deepEqual(db.queries[0].inputs, { limit: 50 });
  assert.equal(RECENT_QUERY.includes("Ip"), false);
});

test("ops:admin-audit creates the table only with --apply and only when it is missing", async () => {
  for (const [exists, apply, expected, statements] of [
    [true, true, { applied: false, auditTable: "exists" }, 1],
    [false, false, { applied: false, auditTable: "missing" }, 1],
    [false, true, { applied: true, auditTable: "created" }, 3],
  ] as const) {
    let created = exists;
    const db = createFakeDatabase((sql) => {
      if (sql === AUDIT_SCHEMA_SQL) created = true;
      return { recordset: [{ audit_table: created ? 1_234 : null }] };
    });
    assert.deepEqual(await applyAdminAuditSchema(db, apply), expected);
    assert.equal(db.queries.length, statements);
    assert.deepEqual(db.transactions, ["begin", "commit"]);
    assert.equal(db.queries[0]?.sql, AUDIT_SCHEMA_STATE_QUERY);
  }
  // A table still missing after the change rolls everything back.
  const failing = createFakeDatabase(() => ({ recordset: [{ audit_table: null }] }));
  await assert.rejects(applyAdminAuditSchema(failing, true), /still missing/);
  assert.deepEqual(failing.transactions, ["begin", "rollback"]);
  assert.match(
    AUDIT_SCHEMA_SQL,
    /^SET XACT_ABORT ON; IF OBJECT_ID\(N'dbo.WebsiteAdminAudit', N'U'\) IS NULL BEGIN CREATE TABLE/,
  );
});

test("the in-memory log of fixtures and tests lists the newest first", async () => {
  const clock = { now: Date.parse("2026-10-06T10:00:00Z") };
  const store = createMemoryAdminAuditStore(() => clock.now);
  await store.record({ discordUserId: "1", action: "page.open", outcome: "allowed" });
  clock.now += 1000;
  await store.record({ discordUserId: "2", action: "page.open", outcome: "allowed", target: "t" });
  assert.deepEqual(await store.recent(1), [
    { at: "2026-10-06T10:00:01.000Z", discordUserId: "2", action: "page.open", target: "t", outcome: "allowed" },
  ]);
  assert.equal((await store.recent(10)).length, 2);
});
