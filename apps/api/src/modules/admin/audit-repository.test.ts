import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDatabase } from "../../test-support/fake-database.ts";
import { createMemoryAdminAuditStore } from "./audit.ts";
import { createSqlAdminAuditStore } from "./audit-repository.ts";

/** A statement's text on one line, as the assertions read it. */
const flat = (text = ""): string => text.replace(/\s+/g, " ").trim();

test("records are written with clipped values and prune old rows once a day", async () => {
  const db = createFakeDatabase();
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

  assert.equal(db.statements.length, 3);
  // One statement whether it prunes or not: the flag is a parameter.
  assert.equal(new Set(db.statements.map((statement) => statement.text)).size, 1);
  const [first, second, third] = db.statements;
  const text = flat(first?.text);
  assert.match(
    text,
    /^INSERT INTO dbo\.WebsiteAdminAudit \(DiscordUserId, Action, Target, Outcome, Ip, RequestId, Details\) VALUES \( @p0, @p1, @p2, @p3, @p4, @p5, @p6 \);/,
  );
  assert.match(
    text,
    /IF @p7 = 1 DELETE FROM dbo\.WebsiteAdminAudit WHERE AtUtc < DATEADD\(DAY, -180, SYSUTCDATETIME\(\)\);$/,
  );
  assert.deepEqual(first?.values, [
    "195905866527014912",
    "page.open",
    "x".repeat(200),
    "allowed",
    "2001:db8::1",
    "req-1",
    null,
    true,
  ]);
  assert.equal(second?.values[7], false);
  assert.equal(second.values[4], null);
  assert.equal(third?.values[7], true);
});

test("the newest entries are read first, without addresses", async () => {
  const db = createFakeDatabase(() => [
    {
      AtUtc: new Date("2026-10-06T10:00:00Z"),
      DiscordUserId: "1",
      Action: "page.open",
      Target: null,
      Outcome: "allowed",
    },
  ]);
  assert.deepEqual(await createSqlAdminAuditStore(db).recent(50), [
    { at: "2026-10-06T10:00:00.000Z", discordUserId: "1", action: "page.open", target: "", outcome: "allowed" },
  ]);
  const text = flat(db.statements[0]?.text);
  assert.equal(
    text,
    "SELECT TOP (@p0) AtUtc, DiscordUserId, Action, Target, Outcome FROM dbo.WebsiteAdminAudit ORDER BY AtUtc DESC, Id DESC;",
  );
  assert.deepEqual(db.statements[0]?.values, [50]);
  assert.equal(text.includes("Ip"), false);
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
