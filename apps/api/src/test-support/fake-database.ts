// A stand-in for the database (db/database.ts): records every statement with its text and parameter values and
// answers from a handler. Transactions are recorded as "begin", "commit" and "rollback" in their own list.

import type { Database, Queries, Row, TransactionOptions } from "../db/database.ts";
import { render, type Statement } from "../db/sql.ts";

export interface RecordedStatement {
  readonly text: string;
  /** The parameter values in order (@p0, @p1, …). */
  readonly values: readonly unknown[];
}

/** What a statement answers: rows (first result set), result sets of a batch, or changed rows. */
export interface FakeResult {
  readonly rows?: readonly object[];
  readonly sets?: readonly (readonly object[])[];
  readonly affected?: readonly number[];
}

export type StatementHandler = (
  statement: RecordedStatement,
) => FakeResult | readonly object[] | undefined | Promise<FakeResult | readonly object[] | undefined>;

export interface FakeDatabase extends Database {
  readonly statements: RecordedStatement[];
  readonly transactions: string[];
}

export function createFakeDatabase(handler: StatementHandler = () => undefined): FakeDatabase {
  const statements: RecordedStatement[] = [];
  const transactions: string[] = [];

  async function answer(statement: Statement): Promise<FakeResult> {
    const { text, parameters } = render(statement);
    const recorded = { text, values: parameters.map((parameter) => parameter.value) };
    statements.push(recorded);
    const result = await handler(recorded);
    return Array.isArray(result) ? { rows: result as readonly object[] } : ((result as FakeResult | undefined) ?? {});
  }

  const firstSet = (result: FakeResult): Row[] => [...(result.rows ?? result.sets?.[0] ?? [])] as Row[];

  const queries: Queries = {
    rows: async <T>(statement: Statement) => firstSet(await answer(statement)) as T[],
    row: async <T>(statement: Statement) => firstSet(await answer(statement))[0] as T | undefined,
    sets: async (statement) => {
      const result = await answer(statement);
      return result.sets ? result.sets.map((set) => [...set] as Row[]) : [firstSet(result)];
    },
    execute: async (statement) => [...((await answer(statement)).affected ?? [])],
  };

  return {
    ...queries,
    statements,
    transactions,
    async transaction<T>(work: (tx: Queries) => Promise<T>, options: TransactionOptions = {}) {
      transactions.push(options.skipPlayerActivity ? "begin (activity paused)" : "begin");
      try {
        const result = await work(queries);
        transactions.push("commit");
        return result;
      } catch (error) {
        transactions.push("rollback");
        throw error;
      }
    },
    ping: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
}
