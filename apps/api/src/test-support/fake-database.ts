// A stand-in for the MSSQL pool: records every query with its parameters and answers from a handler.

import type { Database, Pool } from "../db/database.ts";

export interface RecordedQuery {
  readonly sql: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly types: Readonly<Record<string, unknown>>;
  readonly multiple: boolean;
}

export type QueryHandler = (
  sql: string,
  inputs: Readonly<Record<string, unknown>>,
) => { recordset?: unknown[]; recordsets?: unknown[][] } | Promise<{ recordset?: unknown[]; recordsets?: unknown[][] }>;

export interface FakeDatabase extends Pick<Database, "withPool" | "measurePool"> {
  readonly queries: RecordedQuery[];
}

export function createFakeDatabase(handler: QueryHandler): FakeDatabase {
  const queries: RecordedQuery[] = [];
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
    withPool: (run) => run(pool),
    measurePool: (run) => run(pool, 0),
  };
}
