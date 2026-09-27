import type { FastifyInstance } from "fastify";
import { PUBLIC_DATA_CACHE_CONTROL } from "../../http/cache-control.ts";
import type { RouteContext } from "../../http/route-context.ts";

export function registerEventRoutes(app: FastifyInstance, { data }: RouteContext): void {
  app.get("/api/events/community", async (_request, reply) => {
    const payload = await data.getCommunityEvents();
    return reply.header("Cache-Control", PUBLIC_DATA_CACHE_CONTROL).send(payload);
  });
}
