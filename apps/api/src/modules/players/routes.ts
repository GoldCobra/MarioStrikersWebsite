import type { FastifyInstance } from "fastify";
import { PLAYERS_LIST_KEY } from "../../cache/public-data-keys.ts";
import { badRequest, notFound } from "../../http/errors.ts";
import { rateLimit, sendNoStore, sendPublicData, type RouteContext } from "../../http/route-context.ts";
import { toPositiveIntId } from "../../lib/numbers.ts";

export function registerPlayerRoutes(app: FastifyInstance, { config, data }: RouteContext): void {
  app.get("/api/players", async (_request, reply) => {
    const cached = await data.publicData.get(PLAYERS_LIST_KEY);
    return sendPublicData(reply, cached, cached.payload);
  });

  app.get<{ Params: { playerId: string } }>(
    "/api/players/:playerId/profile",
    rateLimit(config, 120),
    async (request, reply) => {
      const playerId = toPositiveIntId(request.params.playerId);
      if (!playerId) throw badRequest("Invalid player id.");
      const profile = await data.getPlayerProfile(playerId);
      if (!profile) throw notFound("Player not found.");
      return sendNoStore(reply, profile);
    },
  );
}
