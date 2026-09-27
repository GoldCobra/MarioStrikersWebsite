const assert = require("node:assert/strict");
const test = require("node:test");

const ENV_KEYS = [
  "MSSQL_HOST",
  "MSSQL_PORT",
  "MSSQL_DATABASE",
  "MSSQL_USER",
  "MSSQL_PASSWORD",
  "MSSQL_POOL_MIN",
  "MSSQL_POOL_MAX",
  "MSSQL_POOL_IDLE_TIMEOUT_MS",
  "MSSQL_CONNECTION_TIMEOUT_MS",
  "MSSQL_REQUEST_TIMEOUT_MS"
];

function clearDbModules() {
  delete require.cache[require.resolve("./config")];
  delete require.cache[require.resolve("./db")];
}

async function withDbEnv(overrides, run) {
  const previous = {};
  ENV_KEYS.forEach(function (key) {
    previous[key] = process.env[key];
    delete process.env[key];
  });

  Object.assign(process.env, {
    MSSQL_HOST: "db.example.test",
    MSSQL_PORT: "443",
    MSSQL_DATABASE: "MarioStrikers",
    MSSQL_USER: "website",
    MSSQL_PASSWORD: "secret"
  }, overrides || {});

  clearDbModules();
  const db = require("./db");
  try {
    return await run(db);
  } finally {
    db.stopKeepalive();
    ENV_KEYS.forEach(function (key) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    });
    clearDbModules();
  }
}

test("mssql connection config uses stabilized pool and timeout defaults", async function () {
  await withDbEnv({}, async function (db) {
    const config = db.getConnectionConfig();

    assert.equal(config.server, "db.example.test");
    assert.equal(config.database, "MarioStrikers");
    assert.equal(config.user, "website");
    assert.equal(config.password, "secret");
    assert.equal(config.port, 443);
    assert.equal(config.connectionTimeout, 15000);
    assert.equal(config.requestTimeout, 15000);
    assert.deepEqual(config.pool, {
      min: 1,
      max: 10,
      idleTimeoutMillis: 300000
    });
  });
});

test("mssql connection config supports pool and timeout env overrides", async function () {
  await withDbEnv({
    MSSQL_PORT: "11433",
    MSSQL_POOL_MIN: "2",
    MSSQL_POOL_MAX: "12",
    MSSQL_POOL_IDLE_TIMEOUT_MS: "123000",
    MSSQL_CONNECTION_TIMEOUT_MS: "7000",
    MSSQL_REQUEST_TIMEOUT_MS: "9000"
  }, async function (db) {
    const config = db.getConnectionConfig();

    assert.equal(config.port, 11433);
    assert.equal(config.connectionTimeout, 7000);
    assert.equal(config.requestTimeout, 9000);
    assert.deepEqual(config.pool, {
      min: 2,
      max: 12,
      idleTimeoutMillis: 123000
    });
  });
});

test("mssql keepalive starts once and can be stopped", async function () {
  await withDbEnv({}, async function (db) {
    let calls = 0;
    const logger = {
      warn: function () {}
    };
    const run = async function () {
      calls += 1;
    };

    const firstHandle = db.startKeepalive({
      intervalMs: 60000,
      logger: logger,
      run: run
    });
    const secondHandle = db.startKeepalive({
      intervalMs: 60000,
      logger: logger,
      run: run
    });

    assert.equal(firstHandle, secondHandle);
    assert.equal(calls, 1);

    db.stopKeepalive();
    const thirdHandle = db.startKeepalive({
      intervalMs: 60000,
      logger: logger,
      run: run
    });

    assert.notEqual(thirdHandle, firstHandle);
    assert.equal(calls, 2);
  });
});
