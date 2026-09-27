// One-off maintenance commands against the live database configured in apps/api/.env.

import path from "node:path";
import { loadConfig, loadEnvFile, type Config } from "../config.ts";
import { Database } from "../db/database.ts";
import type { Logger } from "../lib/logger.ts";
import { createLogger } from "../server.ts";

export interface OperationContext {
  readonly config: Config;
  readonly database: Database;
  readonly log: Logger;
}

/** Runs `operation`, prints its result as JSON and always closes the pool; failures set exit code 1. */
export async function runOperation(
  name: string,
  operation: (context: OperationContext) => Promise<unknown>,
): Promise<void> {
  loadEnvFile(path.resolve(process.cwd(), ".env"));
  const config = loadConfig(process.env);
  const log = createLogger(config);
  const database = new Database(config.mssql, log);
  try {
    console.log(JSON.stringify(await operation({ config, database, log }), null, 2));
  } catch (error) {
    console.error(`[${name}] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await database.close();
  }
}
