// npm run ops:probe-tls: which TLS settings the database accepts, from strictest to laxest. Run it where
// the API runs (in production: docker exec msc-website-backend node apps/api/src/ops/probe-tls.ts), then
// set MSSQL_TRUST_SERVER_CERTIFICATE and MSSQL_TLS_MIN_VERSION to the first variant that connects.

import { createConnectionConfig, mssql } from "../db/database.ts";
import { runOperation } from "./run-operation.ts";

const VARIANTS = [
  { trustServerCertificate: false, tlsMinVersion: "TLSv1.3" },
  { trustServerCertificate: false, tlsMinVersion: "TLSv1.2" },
  { trustServerCertificate: true, tlsMinVersion: "TLSv1.3" },
  { trustServerCertificate: true, tlsMinVersion: "TLSv1.2" },
  { trustServerCertificate: true, tlsMinVersion: "TLSv1" },
] as const;

await runOperation("ops:probe-tls", async ({ config }) => {
  const results = [];
  for (const variant of VARIANTS) {
    const settings = { ...config.mssql, ...variant, connectionTimeoutMs: 15_000, poolMin: 0, poolMax: 1 };
    let pool: mssql.ConnectionPool | null = null;
    try {
      pool = await new mssql.ConnectionPool(createConnectionConfig(settings)).connect();
      await pool.request().query("SELECT 1 AS ok");
      // Reading the connection's encryption needs VIEW SERVER STATE, which the site's login may lack.
      const encrypted = await pool
        .request()
        .query<{ encrypted: string }>(
          "SELECT encrypt_option AS encrypted FROM sys.dm_exec_connections WHERE session_id = @@SPID",
        )
        .then((result) => result.recordset[0]?.encrypted ?? "unknown")
        .catch(() => "not visible to this login");
      results.push({ ...variant, connects: true, encrypted });
    } catch (error) {
      results.push({ ...variant, connects: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      await pool?.close().catch(() => undefined);
    }
  }
  const strictest = results.find((result) => result.connects);
  return {
    results,
    recommended: strictest
      ? {
          MSSQL_TRUST_SERVER_CERTIFICATE: String(strictest.trustServerCertificate),
          MSSQL_TLS_MIN_VERSION: strictest.tlsMinVersion,
        }
      : null,
  };
});
