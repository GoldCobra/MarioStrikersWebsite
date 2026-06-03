const assert = require("node:assert/strict");
const test = require("node:test");

const dbPath = require.resolve("../db");
const servicePath = require.resolve("./leaderboards-service");

function createRequest(queries, queryHandler) {
  const inputs = {};
  return {
    input: function (name, _type, value) {
      inputs[name] = value;
      return this;
    },
    query: async function (sql) {
      queries.push({ sql: sql, inputs: Object.assign({}, inputs) });
      return queryHandler(sql, inputs);
    }
  };
}

function loadService(queryHandler) {
  const originalDbCache = require.cache[dbPath];
  delete require.cache[servicePath];
  delete require.cache[dbPath];

  const queries = [];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      mssql: {
        DateTime: "DateTime",
        Int: "Int",
        NVarChar: "NVarChar",
        VarChar: "VarChar"
      },
      withPool: async function (run) {
        return run({
          request: function () {
            return createRequest(queries, queryHandler);
          }
        });
      }
    }
  };

  const service = require("./leaderboards-service");
  return {
    service: service,
    queries: queries,
    restore: function () {
      delete require.cache[servicePath];
      delete require.cache[dbPath];
      if (originalDbCache) {
        require.cache[dbPath] = originalDbCache;
      }
    }
  };
}

test("elo1v1 reads the active CompetitiveLeaderboard instead of the legacy rating procedure", async function () {
  const harness = loadService(async function (sql) {
    assert.match(sql, /CompetitiveLeaderboard/);
    assert.doesNotMatch(sql, /GetRatingsForDiscord/);
    return {
      recordset: [
        {
          rank: 1,
          discord_user_id: "650333745232216077",
          display_name: "BKXO",
          total_matches: 1,
          total_wins: 1,
          total_losses: 0,
          rating: 598.9957,
          competitive_rank: "Unranked",
          updated_at: new Date("2026-06-03T22:00:00.000Z")
        }
      ]
    };
  });

  try {
    const rows = await harness.service.getLeaderboardRows({
      gameCode: "msc",
      modeCode: "elo1v1",
      limit: 10,
      offset: 0
    });

    assert.equal(harness.queries.length, 1);
    assert.equal(harness.queries[0].inputs.gametype, 1);
    assert.equal(harness.queries[0].inputs.mode, "1v1");
    assert.equal(harness.queries[0].inputs.limit, 10);
    assert.equal(harness.queries[0].inputs.offset, 0);
    assert.match(harness.queries[0].sql, /season\.LifecycleStatus = 'active'/);
    assert.deepEqual(rows, [
      {
        rank: 1,
        discord_user_id: "650333745232216077",
        display_name: "BKXO",
        total_matches: 1,
        total_wins: 1,
        total_losses: 0,
        total_draws: 0,
        total_game_diff: 0,
        total_goals_for: 0,
        total_goals_against: 0,
        total_goal_diff: 0,
        rating: 599,
        competitive_rank: "Unranked",
        updated_at: "2026-06-03T22:00:00.000Z"
      }
    ]);
  } finally {
    harness.restore();
  }
});

test("elo2v2 maps to the CompetitiveLeaderboard 2v2 mode", async function () {
  const harness = loadService(async function (sql) {
    assert.match(sql, /CompetitiveLeaderboard/);
    return { recordset: [] };
  });

  try {
    await harness.service.getLeaderboardRows({
      gameCode: "msbl",
      modeCode: "elo2v2",
      limit: 25,
      offset: 5
    });

    assert.equal(harness.queries.length, 1);
    assert.equal(harness.queries[0].inputs.gametype, 3);
    assert.equal(harness.queries[0].inputs.mode, "2v2");
  } finally {
    harness.restore();
  }
});

test("whr remains on the legacy rating procedure", async function () {
  const harness = loadService(async function (sql) {
    if (/GetRatingsForDiscord/.test(sql)) {
      return { recordset: [{ line: "<:rookie:123>`Legacy Player 1500`" }] };
    }
    if (/FROM PlayerStats/.test(sql)) {
      return {
        recordset: [
          {
            name: "Legacy Player",
            total_wins: 7,
            total_losses: 3,
            total_draws: 1
          }
        ]
      };
    }
    if (/FROM Player p/.test(sql)) {
      return {
        recordset: [
          {
            name: "Legacy Player",
            discord_user_id: "709777875686916210"
          }
        ]
      };
    }
    throw new Error("Unexpected query: " + sql);
  });

  try {
    const rows = await harness.service.getLeaderboardRows({
      gameCode: "sms",
      modeCode: "whr",
      limit: 10,
      offset: 0
    });

    assert.match(harness.queries[0].sql, /GetRatingsForDiscord/);
    assert.doesNotMatch(harness.queries[0].sql, /CompetitiveLeaderboard/);
    assert.equal(harness.queries[0].inputs.gametype, 2);
    assert.equal(harness.queries[0].inputs.doubles, 0);
    assert.equal(harness.queries[0].inputs.isWhr, 2);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].display_name, "Legacy Player");
    assert.equal(rows[0].rating, 1500);
    assert.equal(rows[0].total_matches, 11);
    assert.equal(rows[0].competitive_rank, "Rookie");
  } finally {
    harness.restore();
  }
});
