import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../config.ts";
import { createConnectionConfig } from "./database.ts";

const BASE_ENV = {
  MSSQL_HOST: "mssql",
  MSSQL_DATABASE: "MarioStrikers",
  MSSQL_USER: "website",
  MSSQL_PASSWORD: "secret",
};

test("the connection defaults fit the SQL Server container next to the API", () => {
  const config = createConnectionConfig(loadConfig(BASE_ENV).mssql);
  assert.equal(config.server, "mssql");
  assert.equal(config.database, "MarioStrikers");
  assert.equal(config.user, "website");
  assert.equal(config.password, "secret");
  assert.equal(config.port, 1433);
  assert.equal(config.connectionTimeout, 5000);
  assert.equal(config.requestTimeout, 15000);
  assert.deepEqual(config.pool, { min: 1, max: 10, idleTimeoutMillis: 300000 });
  // Lent-out connections are checked by their socket, not by a SELECT 1 before every statement.
  assert.equal(config.validateConnection, "socket");
  assert.deepEqual(config.options, {
    encrypt: true,
    trustServerCertificate: true,
    cryptoCredentialsDetails: { minVersion: "TLSv1.2" },
    abortTransactionOnError: true,
  });
});

test("pool, timeouts and TLS can be set", () => {
  const config = createConnectionConfig(
    loadConfig({
      ...BASE_ENV,
      MSSQL_PORT: "11433",
      MSSQL_POOL_MIN: "2",
      MSSQL_POOL_MAX: "12",
      MSSQL_POOL_IDLE_TIMEOUT_MS: "123000",
      MSSQL_CONNECTION_TIMEOUT_MS: "7000",
      MSSQL_REQUEST_TIMEOUT_MS: "9000",
      MSSQL_TRUST_SERVER_CERTIFICATE: "false",
      MSSQL_TLS_MIN_VERSION: "TLSv1.3",
    }).mssql,
  );
  assert.equal(config.port, 11433);
  assert.equal(config.connectionTimeout, 7000);
  assert.equal(config.requestTimeout, 9000);
  assert.deepEqual(config.pool, { min: 2, max: 12, idleTimeoutMillis: 123000 });
  assert.equal(config.options?.trustServerCertificate, false);
  assert.deepEqual(config.options.cryptoCredentialsDetails, { minVersion: "TLSv1.3" });
});

test("a transaction that pauses the activity triggers gets a connection of its own", () => {
  const settings = loadConfig(BASE_ENV).mssql;
  assert.deepEqual(createConnectionConfig(settings, { min: 0, max: 1 }).pool, {
    min: 0,
    max: 1,
    idleTimeoutMillis: 300000,
  });
});

test("a missing database setting is reported by name", () => {
  assert.throws(
    () => createConnectionConfig(loadConfig({ ...BASE_ENV, MSSQL_PASSWORD: "" }).mssql),
    /Missing MSSQL config: MSSQL_PASSWORD/,
  );
});

test("no statement changes a session setting of a pooled connection", () => {
  // mssql lends a connection out again as it is: a SET in a batch would stay on it (SET NOCOUNT ON, for one, empties
  // every later rowsAffected on that connection).
  const sessionSetting =
    /\bSET\s+(NOCOUNT|XACT_ABORT|LOCK_TIMEOUT|TRANSACTION\s+ISOLATION|IMPLICIT_TRANSACTIONS|DEADLOCK_PRIORITY|ANSI_\w+|ARITHABORT|QUOTED_IDENTIFIER|CONCAT_NULL_YIELDS_NULL|DATEFIRST|DATEFORMAT|LANGUAGE)\b/i;
  const root = path.join(import.meta.dirname, "..");
  const offenders = fs
    .readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .filter((file) => sessionSetting.test(fs.readFileSync(path.join(root, file), "utf8")));
  assert.deepEqual(offenders, []);
});
