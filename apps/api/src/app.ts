// The API application: framework setup, cross-cutting plugins and every route module.

import cors from "@fastify/cors";
import etag from "@fastify/etag";
import rateLimitPlugin from "@fastify/rate-limit";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { Config } from "./config.ts";
import type { DataSource } from "./data-source.ts";
import { HttpError, registerErrorHandling } from "./http/errors.ts";
import type { RouteContext } from "./http/route-context.ts";
import { registerAuthRoutes } from "./modules/auth/routes.ts";
import { registerClubRoutes } from "./modules/clubs/routes.ts";
import { registerEventRoutes } from "./modules/events/routes.ts";
import { registerHealthRoutes } from "./modules/health/routes.ts";
import { registerLeaderboardRoutes } from "./modules/leaderboards/routes.ts";
import { registerPlayerRoutes } from "./modules/players/routes.ts";
import { registerProfileRoutes } from "./modules/profile/routes.ts";
import { registerSeasonRoutes } from "./modules/season/routes.ts";
import { registerWiimmfiRoutes } from "./modules/wiimmfi/routes.ts";

export interface AppOptions {
  readonly config: Config;
  readonly data: DataSource;
  /** The process logger; tests leave it out and get no logging. */
  readonly loggerInstance?: FastifyBaseLogger;
}

export async function buildApp({ config, data, loggerInstance }: AppOptions): Promise<FastifyInstance> {
  if (data.source === "fixtures" && config.production) {
    throw new Error("Fixture development mode cannot run in production.");
  }
  const app = Fastify({
    ...(loggerInstance ? { loggerInstance } : { logger: false }),
    requestTimeout: 30_000,
    // Caddy and nginx sit in front in production; their X-Forwarded-For hops identify the client.
    trustProxy: (_address: string, hop: number) => hop < config.trustProxyHops,
    requestIdHeader: "x-request-id",
    bodyLimit: 16 * 1024,
    // Express-compatible matching: /api/players/ and /API/PLAYERS reach /api/players.
    routerOptions: { ignoreTrailingSlash: true, caseSensitive: false },
  });

  registerErrorHandling(app);
  if (data.source === "fixtures") {
    app.addHook("onRequest", async (_request, reply) => {
      reply.header("X-Data-Source", "fixtures");
    });
  }
  // Same-origin in production; CORS stays open (default "*") for community tools that read the API.
  const origins =
    config.corsOrigin === "*"
      ? "*"
      : config.corsOrigin
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean);
  await app.register(cors, { origin: origins });
  // Weak ETags let browsers revalidate the 30-second public responses with 304s.
  await app.register(etag, { weak: true });
  if (config.rateLimitEnabled) {
    await app.register(rateLimitPlugin, {
      global: false,
      // An HttpError, so the answer has the shape of every other error: { error, code, retryAfter }.
      errorResponseBuilder: (_request, context) =>
        new HttpError(429, "RATE_LIMITED", "Too many requests. Try again in a minute.", { retryAfter: context.after }),
    });
  }

  const context: RouteContext = { config, data };
  registerHealthRoutes(app, context);
  registerAuthRoutes(app, context);
  registerProfileRoutes(app, context);
  registerLeaderboardRoutes(app, context);
  registerPlayerRoutes(app, context);
  registerSeasonRoutes(app, context);
  registerClubRoutes(app, context);
  registerEventRoutes(app, context);
  registerWiimmfiRoutes(app, context);
  return app;
}
