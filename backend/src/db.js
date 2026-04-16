const mssql = require("mssql");
const { config, assertMssqlConfigured } = require("./config");

let poolPromise = null;

function getConnectionConfig() {
  assertMssqlConfigured();
  return {
    user: config.mssqlUser,
    password: config.mssqlPassword,
    server: config.mssqlHost,
    database: config.mssqlDatabase,
    port: Number(config.mssqlPort || 443),
    options: {
      encrypt: true,
      trustServerCertificate: true,
      cryptoCredentialsDetails: {
        minVersion: "TLSv1"
      }
    }
  };
}

async function getPool() {
  if (!poolPromise) {
    poolPromise = mssql.connect(getConnectionConfig());
  }
  return poolPromise;
}

async function withPool(run) {
  const pool = await getPool();
  return run(pool);
}

async function healthCheck() {
  return withPool(async function (pool) {
    await pool.request().query("SELECT 1 AS ok;");
    return true;
  });
}

async function closePool() {
  if (!poolPromise) {
    return;
  }

  try {
    const pool = await poolPromise;
    await pool.close();
  } catch (_error) {
    // Ignore close failures if the initial connect never succeeded.
  } finally {
    poolPromise = null;
  }
}

module.exports = {
  mssql,
  withPool,
  healthCheck,
  closePool
};
