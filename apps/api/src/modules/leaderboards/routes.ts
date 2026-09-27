import type { FastifyInstance } from "fastify";
import {
  PUBLIC_LEADERBOARD_LIMIT,
  isPublicLeaderboardVariant,
  leaderboardCacheKey,
} from "../../cache/public-data-keys.ts";
import { rateLimit, sendPublicData, type RouteContext } from "../../http/route-context.ts";
import { assertGameAndMode, parseLimit, parseOffset } from "./params.ts";

interface LeaderboardRequest {
  Params: { game: string; mode: string };
  Querystring: { limit?: unknown; offset?: unknown };
}

function slicePayload(
  payload: unknown,
  limit: number,
): { game: unknown; mode: unknown; count: number; rows: unknown[] } {
  const record = (payload ?? {}) as { game?: unknown; mode?: unknown; rows?: unknown };
  const rows = Array.isArray(record.rows) ? record.rows.slice(0, limit) : [];
  return { game: record.game, mode: record.mode, count: rows.length, rows };
}

export function registerLeaderboardRoutes(app: FastifyInstance, { config, data }: RouteContext): void {
  // The first 100 rows of the public ladders come from the shared cache; other slices read the database.
  app.get<LeaderboardRequest>("/api/leaderboards/:game/:mode", rateLimit(config, 120), async (request, reply) => {
    const { game, mode } = assertGameAndMode(request.params.game, request.params.mode);
    const limit = parseLimit(request.query.limit, config.leaderboardDefaultLimit, config.leaderboardMaxLimit);
    const offset = parseOffset(request.query.offset);
    if (offset === 0 && limit <= PUBLIC_LEADERBOARD_LIMIT && isPublicLeaderboardVariant(game, mode)) {
      const cached = await data.publicData.get(leaderboardCacheKey(game, mode));
      return sendPublicData(reply, cached, slicePayload(cached.payload, limit));
    }
    const rows = await data.getLeaderboardRows({
      gameCode: game,
      modeCode: mode,
      limit: request.query.limit,
      offset: request.query.offset,
    });
    return reply.send({ game, mode, count: rows.length, rows });
  });

  app.get<LeaderboardRequest>("/api/leaderboards/:game/:mode/top", rateLimit(config, 120), async (request, reply) => {
    const { game, mode } = assertGameAndMode(request.params.game, request.params.mode);
    const limit = parseLimit(request.query.limit, 25, config.leaderboardMaxLimit);
    if (isPublicLeaderboardVariant(game, mode)) {
      const cached = await data.publicData.get(leaderboardCacheKey(game, mode));
      return sendPublicData(reply, cached, slicePayload(cached.payload, Math.min(limit, PUBLIC_LEADERBOARD_LIMIT)));
    }
    const rows = await data.getLeaderboardRows({
      gameCode: game,
      modeCode: mode,
      limit: Math.min(limit, 100),
      offset: 0,
    });
    return reply.send({ game, mode, count: rows.length, rows });
  });
}
