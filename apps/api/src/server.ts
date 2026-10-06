// Starting and stopping the API process; shared by main.ts, dev.ts and dev-live.ts.

import { pino, type Logger as PinoLogger } from "pino";
import { buildApp } from "./app.ts";
import type { Config } from "./config.ts";
import type { DataSource } from "./data-source.ts";

const SHUTDOWN_TIMEOUT_MS = 10_000;

/** JSON log lines at the configured level. Cookies, tokens and the admin page's path are never logged. */
export function createLogger(config: Config): PinoLogger {
  return pino({
    level: config.logLevel,
    redact: [
      "req.headers.cookie",
      "req.headers.authorization",
      'req.headers["x-original-uri"]',
      'res.headers["set-cookie"]',
    ],
  });
}

export interface StartOptions {
  readonly config: Config;
  readonly host: string;
  readonly log: PinoLogger;
  readonly data: DataSource;
}

/** Listens, starts background refreshes and shuts down cleanly on SIGINT/SIGTERM. */
export async function startServer({
  config,
  host,
  log,
  data,
}: StartOptions): Promise<{ port: number; close: () => Promise<void> }> {
  const app = await buildApp({ config, data, loggerInstance: log });
  await app.listen({ port: config.port, host });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  data.start();

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      const timer = setTimeout(() => {
        log.error("[api] Shutdown timed out; exiting.");
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      timer.unref();
      await app.close();
      await data.stop();
      clearTimeout(timer);
    })();
    return closing;
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      log.info(`[api] Received ${signal}; shutting down.`);
      void close().then(() => process.exit(0));
    });
  }
  return { port, close };
}
