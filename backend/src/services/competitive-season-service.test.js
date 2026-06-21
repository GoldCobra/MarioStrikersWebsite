const assert = require("node:assert/strict");
const test = require("node:test");
const { mapSeasonRow, toBoolean } = require("./competitive-season-service");

test("toBoolean treats 1/true/'1' as true and everything else as false", function () {
  assert.equal(toBoolean(1), true);
  assert.equal(toBoolean(true), true);
  assert.equal(toBoolean("1"), true);
  assert.equal(toBoolean(0), false);
  assert.equal(toBoolean(false), false);
  assert.equal(toBoolean(null), false);
  assert.equal(toBoolean("true"), false);
});

test("mapSeasonRow returns null when there is no season row", function () {
  assert.equal(mapSeasonRow(null), null);
  assert.equal(mapSeasonRow({}), null);
  assert.equal(mapSeasonRow({ Id: null }), null);
});

test("mapSeasonRow maps a season row to the public shape", function () {
  const mapped = mapSeasonRow({
    Id: 7,
    SeasonNumber: 3,
    DisplayName: "  Season 3  ",
    StartDateUtc: new Date("2026-01-01T00:00:00.000Z"),
    EndDateUtc: new Date("2026-04-01T00:00:00.000Z"),
    IsActive: 1,
    IsCompleted: 0,
    LifecycleStatus: "active"
  });

  assert.equal(mapped.id, 7);
  assert.equal(mapped.seasonNumber, 3);
  assert.equal(mapped.displayName, "Season 3");
  assert.equal(mapped.startDateUtc, "2026-01-01T00:00:00.000Z");
  assert.equal(mapped.endDateUtc, "2026-04-01T00:00:00.000Z");
  assert.equal(mapped.isActive, true);
  assert.equal(mapped.isCompleted, false);
  assert.equal(mapped.lifecycleStatus, "active");
});

test("mapSeasonRow returns null isodates for missing/invalid timestamps", function () {
  const mapped = mapSeasonRow({ Id: 1, SeasonNumber: 1, StartDateUtc: null, EndDateUtc: "not-a-date" });
  assert.equal(mapped.startDateUtc, null);
  assert.equal(mapped.endDateUtc, null);
});
