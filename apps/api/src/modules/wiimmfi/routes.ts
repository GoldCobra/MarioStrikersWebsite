import type { FastifyInstance } from "fastify";
import { PUBLIC_DATA_CACHE_CONTROL } from "../../http/cache-control.ts";
import { HttpError } from "../../http/errors.ts";
import type { RouteContext } from "../../http/route-context.ts";
import type { WiimmfiPlayer } from "./service.ts";

export function registerWiimmfiRoutes(app: FastifyInstance, { data }: RouteContext): void {
  app.get("/api/wiimmfi/msc-charged", async (request, reply) => {
    let players: WiimmfiPlayer[];
    try {
      players = await data.getWiimmfiPlayers();
    } catch (err) {
      request.log.warn({ err }, "[wiimmfi] No player list available");
      throw new HttpError(503, "UPSTREAM_UNAVAILABLE", "Wiimmfi data is unavailable.");
    }
    return reply.header("Cache-Control", PUBLIC_DATA_CACHE_CONTROL).send({ count: players.length, players });
  });
}
