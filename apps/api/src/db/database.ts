// The shared MSSQL connection pool. It reconnects lazily after connection errors and can run a
// keepalive query so the external database does not drop idle connections.

import mssql from "mssql";
import { assertMssqlConfigured, type MssqlConfig } from "../config.ts";
import type { Logger } from "../lib/logger.ts";

const DEFAULT_KEEPALIVE_INTERVAL_MS = 25_000;
const CONNECTION_LOST = /Failed to connect|Connection is closed|ESOCKET|ETIMEOUT|EAI_AGAIN/i;

export type Pool = mssql.ConnectionPool;
export { mssql };

export function createConnectionConfig(settings: MssqlConfig): mssql.config {
  assertMssqlConfigured(settings);
  return {
    user: settings.user,
    password: settings.password,
    server: settings.host,
    database: settings.database,
    port: settings.port,
    connectionTimeout: settings.connectionTimeoutMs,
    requestTimeout: settings.requestTimeoutMs,
    pool: {
      min: settings.poolMin,
      max: settings.poolMax,
      idleTimeoutMillis: settings.poolIdleTimeoutMs,
    },
    options: {
      encrypt: true,
      trustServerCertificate: settings.trustServerCertificate,
      cryptoCredentialsDetails: { minVersion: settings.tlsMinVersion },
    },
  };
}

export class Database {
  private poolPromise: Promise<Pool> | null = null;
  private keepaliveHandle: NodeJS.Timeout | null = null;
  private readonly settings: MssqlConfig;
  private readonly log: Logger;

  constructor(settings: MssqlConfig, log: Logger) {
    this.settings = settings;
    this.log = log;
  }

  private getPool(): Promise<Pool> {
    this.poolPromise ??= mssql
      .connect(createConnectionConfig(this.settings))
      .then((pool) => {
        pool.on("error", (err: unknown) => {
          this.log.error({ err }, "[mssql] Pool error");
          this.poolPromise = null;
        });
        return pool;
      })
      .catch((error: unknown) => {
        this.poolPromise = null;
        throw error;
      });
    return this.poolPromise;
  }

  /** Runs `run` with the pool and the time spent waiting for it (for slow-query logs). */
  async measurePool<T>(run: (pool: Pool, poolMs: number) => Promise<T>): Promise<T> {
    try {
      const startedAt = Date.now();
      const pool = await this.getPool();
      return await run(pool, Date.now() - startedAt);
    } catch (error) {
      if (error instanceof Error && CONNECTION_LOST.test(error.message)) this.poolPromise = null;
      throw error;
    }
  }

  withPool<T>(run: (pool: Pool) => Promise<T>): Promise<T> {
    return this.measurePool((pool) => run(pool));
  }

  async healthCheck(): Promise<void> {
    await this.withPool((pool) => pool.request().query("SELECT 1 AS ok;"));
  }

  startKeepalive(options: { intervalMs?: number; run?: () => Promise<void> } = {}): NodeJS.Timeout {
    if (this.keepaliveHandle) return this.keepaliveHandle;
    const run = options.run ?? (() => this.healthCheck());
    const tick = (): void => {
      run().catch((err: unknown) => {
        this.log.warn({ err }, "[mssql] Keepalive failed");
      });
    };
    tick();
    this.keepaliveHandle = setInterval(tick, options.intervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS);
    this.keepaliveHandle.unref();
    return this.keepaliveHandle;
  }

  stopKeepalive(): void {
    if (!this.keepaliveHandle) return;
    clearInterval(this.keepaliveHandle);
    this.keepaliveHandle = null;
  }

  async close(): Promise<void> {
    this.stopKeepalive();
    const pending = this.poolPromise;
    this.poolPromise = null;
    if (!pending) return;
    try {
      await (await pending).close();
    } catch {
      // The initial connect may never have succeeded.
    }
  }
}
