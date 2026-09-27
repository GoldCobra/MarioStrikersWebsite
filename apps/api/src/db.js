const mssql = require("mssql");
const { config, assertMssqlConfigured } = require("./config");

let poolPromise = null;
let keepaliveHandle = null;

const DEFAULT_KEEPALIVE_INTERVAL_MS = 25000;

function getConnectionConfig() {
  assertMssqlConfigured();
  return {
    user: config.mssqlUser,
    password: config.mssqlPassword,
    server: config.mssqlHost,
    database: config.mssqlDatabase,
    port: Number(config.mssqlPort || 443),
    connectionTimeout: Number(config.mssqlConnectionTimeoutMs || 15000),
    requestTimeout: Number(config.mssqlRequestTimeoutMs || 15000),
    pool: {
      min: Number(config.mssqlPoolMin || 1),
      max: Number(config.mssqlPoolMax || 10),
      idleTimeoutMillis: Number(config.mssqlPoolIdleTimeoutMs || 300000)
    },
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
    poolPromise = mssql.connect(getConnectionConfig()).then(function (pool) {
      pool.on("error", function (error) {
        console.error("[mssql] Pool error:", error);
        poolPromise = null;
      });
      return pool;
    }).catch(function (error) {
      poolPromise = null;
      throw error;
    });
  }
  return poolPromise;
}

async function measurePool(run) {
  try {
    const startedAt = Date.now();
    const pool = await getPool();
    const poolMs = Date.now() - startedAt;
    return await run(pool, poolMs);
  } catch (error) {
    if (error && /Failed to connect|Connection is closed|ESOCKET|ETIMEOUT|EAI_AGAIN/i.test(String(error.message || ""))) {
      poolPromise = null;
    }
    throw error;
  }
}

async function withPool(run) {
  return measurePool(async function (pool) {
    return run(pool);
  });
}

async function healthCheck() {
  return withPool(async function (pool) {
    await pool.request().query("SELECT 1 AS ok;");
    return true;
  });
}

function startKeepalive(options) {
  if (keepaliveHandle) {
    return keepaliveHandle;
  }

  const opts = options || {};
  const intervalMs = Number(opts.intervalMs || DEFAULT_KEEPALIVE_INTERVAL_MS);
  const logger = opts.logger || console;
  const run = typeof opts.run === "function" ? opts.run : healthCheck;

  async function tick() {
    try {
      await run();
    } catch (error) {
      if (logger && typeof logger.warn === "function") {
        logger.warn("[mssql] Keepalive failed:", error && error.message ? error.message : error);
      }
    }
  }

  tick();
  keepaliveHandle = setInterval(tick, intervalMs);
  if (typeof keepaliveHandle.unref === "function") {
    keepaliveHandle.unref();
  }
  return keepaliveHandle;
}

function stopKeepalive() {
  if (!keepaliveHandle) {
    return;
  }
  clearInterval(keepaliveHandle);
  keepaliveHandle = null;
}

async function closePool() {
  stopKeepalive();
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
  getConnectionConfig,
  getPool,
  measurePool,
  withPool,
  healthCheck,
  startKeepalive,
  stopKeepalive,
  closePool
};
