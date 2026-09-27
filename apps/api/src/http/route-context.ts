// What every route module receives, and small reply helpers they share.

import type { FastifyReply } from "fastify";
import type { CacheResult } from "../cache/public-data-cache.ts";
import type { Config } from "../config.ts";
import type { DataSource } from "../data-source.ts";
import { NO_STORE, PUBLIC_DATA_CACHE_CONTROL } from "./cache-control.ts";

export interface RouteContext {
  readonly config: Config;
  readonly data: DataSource;
}

/** Route option that applies a per-IP limit when rate limiting is enabled (production). */
export function rateLimit(
  config: Config,
  max: number,
): { config?: { rateLimit: { max: number; timeWindow: number } } } {
  return config.rateLimitEnabled ? { config: { rateLimit: { max, timeWindow: 60_000 } } } : {};
}

/** A shared dataset with its cache state, cacheable by browsers for 30 s. */
export function sendPublicData(reply: FastifyReply, cached: CacheResult, payload: unknown): FastifyReply {
  return reply
    .header("X-Data-Cache", cached.cacheStatus)
    .header("X-Data-Generated-At", cached.generatedAt)
    .header("Cache-Control", PUBLIC_DATA_CACHE_CONTROL)
    .send(payload);
}

export function sendNoStore(reply: FastifyReply, payload: unknown, statusCode = 200): FastifyReply {
  return reply.code(statusCode).header("Cache-Control", NO_STORE).send(payload);
}
