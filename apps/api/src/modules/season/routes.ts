import type { FastifyInstance } from "fastify";
import { COMPETITIVE_SEASON_KEY } from "../../cache/public-data-keys.ts";
import { NO_STORE } from "../../http/cache-control.ts";
import type { RouteContext } from "../../http/route-context.ts";

export function registerSeasonRoutes(app: FastifyInstance, { data }: RouteContext): void {
  // The season payload is cached, but its clock is not: countdowns sync to serverNowUtc.
  app.get("/api/competitive-season/current", async (_request, reply) => {
    reply.header("Cache-Control", NO_STORE);
    const cached = await data.publicData.get(COMPETITIVE_SEASON_KEY);
    return reply
      .header("X-Data-Cache", cached.cacheStatus)
      .header("X-Data-Generated-At", cached.generatedAt)
      .send({ ...(cached.payload as Record<string, unknown>), serverNowUtc: new Date(data.now()).toISOString() });
  });
}
