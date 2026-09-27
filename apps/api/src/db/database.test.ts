import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../config.ts";
import { silentLogger } from "../lib/logger.ts";
import { Database, createConnectionConfig } from "./database.ts";

const BASE_ENV = {
  MSSQL_HOST: "db.example.test",
  MSSQL_PORT: "443",
  MSSQL_DATABASE: "MarioStrikers",
  MSSQL_USER: "website",
  MSSQL_PASSWORD: "secret",
};

test("mssql connection config uses stabilized pool and timeout defaults", () => {
  const config = createConnectionConfig(loadConfig(BASE_ENV, { isolated: true }).mssql);
  assert.equal(config.server, "db.example.test");
  assert.equal(config.database, "MarioStrikers");
  assert.equal(config.user, "website");
  assert.equal(config.password, "secret");
  assert.equal(config.port, 443);
  assert.equal(config.connectionTimeout, 15000);
  assert.equal(config.requestTimeout, 15000);
  assert.deepEqual(config.pool, { min: 1, max: 10, idleTimeoutMillis: 300000 });
  // Today's TLS settings stay the default until the database host has been probed.
  assert.deepEqual(config.options, {
    encrypt: true,
    trustServerCertificate: true,
    cryptoCredentialsDetails: { minVersion: "TLSv1" },
  });
});

test("mssql connection config supports pool, timeout and TLS overrides", () => {
  const config = createConnectionConfig(
    loadConfig(
      {
        ...BASE_ENV,
        MSSQL_PORT: "11433",
        MSSQL_POOL_MIN: "2",
        MSSQL_POOL_MAX: "12",
        MSSQL_POOL_IDLE_TIMEOUT_MS: "123000",
        MSSQL_CONNECTION_TIMEOUT_MS: "7000",
        MSSQL_REQUEST_TIMEOUT_MS: "9000",
        MSSQL_TRUST_SERVER_CERTIFICATE: "false",
        MSSQL_TLS_MIN_VERSION: "TLSv1.2",
      },
      { isolated: true },
    ).mssql,
  );
  assert.equal(config.port, 11433);
  assert.equal(config.connectionTimeout, 7000);
  assert.equal(config.requestTimeout, 9000);
  assert.deepEqual(config.pool, { min: 2, max: 12, idleTimeoutMillis: 123000 });
  assert.equal(config.options?.trustServerCertificate, false);
  assert.deepEqual(config.options.cryptoCredentialsDetails, { minVersion: "TLSv1.2" });
});

test("a missing database setting is reported by name", () => {
  assert.throws(
    () => createConnectionConfig(loadConfig({ ...BASE_ENV, MSSQL_PASSWORD: "" }, { isolated: true }).mssql),
    /Missing MSSQL config: MSSQL_PASSWORD/,
  );
});

test("mssql keepalive starts once and can be stopped", () => {
  const database = new Database(loadConfig(BASE_ENV, { isolated: true }).mssql, silentLogger);
  let calls = 0;
  const run = async (): Promise<void> => {
    calls += 1;
    await Promise.resolve();
  };
  const first = database.startKeepalive({ intervalMs: 60000, run });
  const second = database.startKeepalive({ intervalMs: 60000, run });
  assert.equal(first, second);
  assert.equal(calls, 1);
  database.stopKeepalive();
  const third = database.startKeepalive({ intervalMs: 60000, run });
  assert.notEqual(third, first);
  assert.equal(calls, 2);
  database.stopKeepalive();
});
