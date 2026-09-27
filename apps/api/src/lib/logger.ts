import type { FastifyBaseLogger } from "fastify";

/** The pino-style logger the API uses everywhere: log.warn({ err }, "message"). */
export type Logger = Pick<FastifyBaseLogger, "debug" | "info" | "warn" | "error">;

/** A logger that drops everything; for tests and one-off scripts. */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
