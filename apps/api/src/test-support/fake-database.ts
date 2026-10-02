// A stand-in for the MSSQL pool: records every query with its parameters and answers from a handler.
// Transactions are recorded as "begin", "commit" and "rollback" in their own list.

import type { Database, Pool } from "../db/database.ts";

export interface RecordedQuery {
  readonly sql: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly types: Readonly<Record<string, unknown>>;
  readonly multiple: boolean;
}

export interface QueryResult {
  recordset?: unknown[];
  recordsets?: unknown[][];
  rowsAffected?: number[];
}

export type QueryHandler = (
  sql: string,
  inputs: Readonly<Record<string, unknown>>,
) => QueryResult | Promise<QueryResult>;

export interface FakeDatabase extends Pick<Database, "withPool" | "measurePool" | "withTransaction"> {
  readonly queries: RecordedQuery[];
  readonly transactions: string[];
}

export function createFakeDatabase(handler: QueryHandler): FakeDatabase {
  const queries: RecordedQuery[] = [];
  const transactions: string[] = [];
  const pool = {
    request() {
      const inputs: Record<string, unknown> = {};
      const types: Record<string, unknown> = {};
      const request = {
        multiple: false,
        input(name: string, type: unknown, value?: unknown) {
          // mssql accepts input(name, value) as well as input(name, type, value).
          if (arguments.length === 2) inputs[name] = type;
          else {
            inputs[name] = value;
            types[name] = type;
          }
          return request;
        },
        async query(sql: string) {
          queries.push({ sql, inputs: { ...inputs }, types: { ...types }, multiple: request.multiple });
          return handler(sql, inputs);
        },
      };
      return request;
    },
  } as unknown as Pool;
  return {
    queries,
    transactions,
    withPool: (run) => run(pool),
    measurePool: (run) => run(pool, 0),
    withTransaction: async (run) => {
      transactions.push("begin");
      try {
        const result = await run(pool);
        transactions.push("commit");
        return result;
      } catch (error) {
        transactions.push("rollback");
        throw error;
      }
    },
  };
}
