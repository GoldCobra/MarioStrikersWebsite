// The database (docs/adr/0014): one mssql pool to the SQL Server next to the API. Statements come from sql.ts, each
// one is timed (a slow one is logged), and a transaction can run again after a deadlock. Every connection runs with
// XACT_ABORT ON, so an error inside a transaction always rolls all of it back. mssql lends connections out again as
// they are, so no statement may change a session setting (NOCOUNT, LOCK_TIMEOUT, …): it would stay on the
// connection for everyone after it (a test checks the sources).

import mssql from "mssql";
import { assertMssqlConfigured, type MssqlConfig } from "../config.ts";
import type { Logger } from "../lib/logger.ts";
import { isDeadlock } from "../lib/sql-errors.ts";
import { render, sql, type Statement } from "./sql.ts";

export type Row = Record<string, unknown>;

/**
 * Running statements, on the pool or in one transaction. In a transaction they run one after another: they share its
 * connection, so they are awaited in turn, never together.
 */
export interface Queries {
  /** The rows of the first result set. */
  rows<T = Row>(statement: Statement): Promise<T[]>;
  /** The first row of the first result set; undefined without one. */
  row<T = Row>(statement: Statement): Promise<T | undefined>;
  /** Every result set of a batch, in order. */
  sets(statement: Statement): Promise<Row[][]>;
  /** Runs the statement or batch; the rows each statement changed. */
  execute(statement: Statement): Promise<number[]>;
}

export interface TransactionOptions {
  /** How often the whole transaction runs again after a deadlock or a lock timeout (default: never). */
  readonly retries?: number;
  /**
   * dbo.Player's activity triggers paused (SESSION_CONTEXT SkipPlayerActivity): an admin rewrite is no activity of
   * the player. Such a transaction gets a connection of its own that is closed afterwards, so the flag never reaches
   * another statement, not even after the server rolled the transaction back.
   */
  readonly skipPlayerActivity?: boolean;
}

export interface Database extends Queries {
  /** Runs `work` in one transaction: committed when it returns, rolled back when it throws. */
  transaction<T>(work: (tx: Queries) => Promise<T>, options?: TransactionOptions): Promise<T>;
  /** One round trip to the server (the health check). */
  ping(): Promise<void>;
  close(): Promise<void>;
}

export interface DatabaseOptions {
  /** A statement slower than this is logged as a warning (default 500 ms). */
  readonly slowMs?: number;
}

const SKIP_PLAYER_ACTIVITY = sql`EXEC sys.sp_set_session_context @key = N'SkipPlayerActivity', @value = 1;`;

export function createConnectionConfig(settings: MssqlConfig, pool?: { min: number; max: number }): mssql.config {
  assertMssqlConfigured(settings);
  return {
    server: settings.host,
    port: settings.port,
    database: settings.database,
    user: settings.user,
    password: settings.password,
    connectionTimeout: settings.connectionTimeoutMs,
    requestTimeout: settings.requestTimeoutMs,
    pool: {
      min: pool?.min ?? settings.poolMin,
      max: pool?.max ?? settings.poolMax,
      idleTimeoutMillis: settings.poolIdleTimeoutMs,
    },
    // A lent-out connection is checked by its socket, not with a SELECT 1 round trip before every statement.
    validateConnection: "socket",
    options: {
      encrypt: true,
      trustServerCertificate: settings.trustServerCertificate,
      cryptoCredentialsDetails: { minVersion: settings.tlsMinVersion },
      abortTransactionOnError: true,
    },
  };
}

/** The statement's first line or so, for logs. */
function summarize(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 157)}...` : flat;
}

type Source = mssql.ConnectionPool | mssql.Transaction;

/** What mssql answers; a statement without a result set (an UPDATE) has no recordset, whatever its types say. */
interface Result {
  readonly recordset?: Row[];
  readonly recordsets: Row[][];
  readonly rowsAffected: number[];
}

export function createDatabase(settings: MssqlConfig, log: Logger, options: DatabaseOptions = {}): Database {
  const slowMs = options.slowMs ?? 500;
  let poolPromise: Promise<mssql.ConnectionPool> | null = null;

  const connect = (pool?: { min: number; max: number }): Promise<mssql.ConnectionPool> =>
    new mssql.ConnectionPool(createConnectionConfig(settings, pool)).connect();

  function sharedPool(): Promise<mssql.ConnectionPool> {
    poolPromise ??= connect()
      .then((pool) => {
        pool.on("error", (err: unknown) => {
          log.error({ err }, "[db] Pool error");
        });
        return pool;
      })
      .catch((error: unknown) => {
        // The next statement tries again (the server may still be starting).
        poolPromise = null;
        throw error;
      });
    return poolPromise;
  }

  async function run(source: Source, statement: Statement): Promise<Result> {
    const { text, parameters } = render(statement);
    const request = source.request();
    for (const parameter of parameters) request.input(parameter.name, parameter.type, parameter.value);
    const startedAt = performance.now();
    try {
      return await request.query<Row>(text);
    } finally {
      const ms = performance.now() - startedAt;
      if (ms >= slowMs) log.warn({ ms: Math.round(ms), statement: summarize(text) }, "[db] Slow statement");
    }
  }

  function queriesOn(source: () => Promise<Source>): Queries {
    return {
      rows: async <T>(statement: Statement) => ((await run(await source(), statement)).recordset ?? []) as T[],
      row: async <T>(statement: Statement) => (await run(await source(), statement)).recordset?.[0] as T | undefined,
      sets: async (statement) => (await run(await source(), statement)).recordsets,
      execute: async (statement) => [...(await run(await source(), statement)).rowsAffected],
    };
  }

  async function inTransaction<T>(pool: mssql.ConnectionPool, work: (tx: Queries) => Promise<T>, first?: Statement) {
    const transaction = new mssql.Transaction(pool);
    await transaction.begin();
    try {
      const tx = queriesOn(() => Promise.resolve(transaction));
      if (first) await tx.execute(first);
      const result = await work(tx);
      await transaction.commit();
      return result;
    } catch (error) {
      // After XACT_ABORT the server has rolled back already; mssql then refuses the rollback, which changes nothing.
      await transaction.rollback().catch(() => undefined);
      throw error;
    }
  }

  async function once<T>(work: (tx: Queries) => Promise<T>, options: TransactionOptions): Promise<T> {
    if (!options.skipPlayerActivity) return inTransaction(await sharedPool(), work);
    const own = await connect({ min: 0, max: 1 });
    try {
      return await inTransaction(own, work, SKIP_PLAYER_ACTIVITY);
    } finally {
      await own.close().catch(() => undefined);
    }
  }

  return {
    ...queriesOn(sharedPool),

    async transaction(work, options = {}) {
      const attempts = 1 + Math.max(0, options.retries ?? 0);
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await once(work, options);
        } catch (error) {
          if (attempt >= attempts || !isDeadlock(error)) throw error;
          log.warn({ attempt }, "[db] Deadlock, the transaction runs again");
        }
      }
    },

    async ping() {
      await run(await sharedPool(), sql`SELECT 1 AS ok;`);
    },

    async close() {
      const pending = poolPromise;
      poolPromise = null;
      if (!pending) return;
      try {
        await (await pending).close();
      } catch {
        // The first connect may never have succeeded.
      }
    },
  };
}
