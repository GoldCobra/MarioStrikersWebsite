// One error shape for every API response: { error, code, ...extra }. Internal errors are logged with the
// request id and answered generically, so database or configuration details never reach clients.
// Error responses are never cached.

import type { FastifyError, FastifyInstance } from "fastify";
import { NO_STORE } from "./cache-control.ts";

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly extra: Readonly<Record<string, unknown>>;

  constructor(statusCode: number, code: string, message: string, extra: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (message: string): HttpError => new HttpError(400, "BAD_REQUEST", message);
export const notFound = (message: string): HttpError => new HttpError(404, "NOT_FOUND", message);

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | HttpError, request, reply) => {
    reply.header("Cache-Control", NO_STORE);
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.message, code: error.code, ...error.extra });
    }
    // Framework client errors (malformed JSON, oversized bodies, rate limits) keep their status.
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return reply.code(status).send({ error: error.message, code: error.code || "BAD_REQUEST" });
    }
    request.log.error({ err: error }, "Request failed");
    return reply.code(500).send({ error: "Internal server error.", code: "INTERNAL" });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).header("Cache-Control", NO_STORE).send({ error: "Not found.", code: "NOT_FOUND" }),
  );
}
