import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import { MSBL_CLUBS_KEY } from "../../cache/public-data-keys.ts";
import { IMMUTABLE_ASSET } from "../../http/cache-control.ts";
import { badRequest, notFound } from "../../http/errors.ts";
import { rateLimit, sendNoStore, sendPublicData, type RouteContext } from "../../http/route-context.ts";
import { toPositiveIntOrNull } from "../../lib/numbers.ts";

export function registerClubRoutes(app: FastifyInstance, { config, data }: RouteContext): void {
  app.get("/api/clubs", async (_request, reply) => {
    const cached = await data.publicData.get(MSBL_CLUBS_KEY);
    return sendPublicData(reply, cached, cached.payload);
  });

  app.get("/api/clubs/msbl", async (_request, reply) => {
    const cached = await data.publicData.get(MSBL_CLUBS_KEY);
    return sendPublicData(reply, cached, cached.payload);
  });

  // Logo URLs carry the file hash (?v=), so browsers may keep them forever.
  app.get<{ Params: { clubId: string } }>("/api/clubs/msbl/:clubId/logo", async (request, reply) => {
    const logo = await data.getClubLogoFile(request.params.clubId);
    if (!logo) throw notFound("Club logo not found.");
    const etag = `"${logo.hash}"`;
    reply.header("Cache-Control", IMMUTABLE_ASSET).header("ETag", etag);
    if (request.headers["if-none-match"] === etag) return reply.code(304).send();
    return reply.type(logo.contentType).send(createReadStream(logo.absolutePath));
  });

  app.get<{ Params: { clubId: string } }>(
    "/api/clubs/msbl/:clubId/profile",
    rateLimit(config, 120),
    async (request, reply) => {
      const clubId = toPositiveIntOrNull(request.params.clubId);
      if (!clubId) throw badRequest("Invalid club id.");
      const profile = await data.getClubProfile(clubId);
      if (!profile) throw notFound("Club not found.");
      return sendNoStore(reply, profile);
    },
  );
}
