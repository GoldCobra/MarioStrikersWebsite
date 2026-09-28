import type { FastifyInstance } from "fastify";
import { COMPETITIVE_SEASON_KEY } from "../../cache/public-data-keys.ts";
import { NO_STORE } from "../../http/cache-control.ts";
import type { RouteContext } from "../../http/route-context.ts";
import type { Season, SeasonStatus } from "./service.ts";

/** The season as the API sends it (snake_case, like every other response); the cache keeps the service's shape. */
function seasonJson(season: Season | null | undefined): Record<string, unknown> | null {
  if (!season) return null;
  return {
    id: season.id,
    season_number: season.seasonNumber,
    display_name: season.displayName,
    start_date_utc: season.startDateUtc,
    end_date_utc: season.endDateUtc,
    is_active: season.isActive,
    is_completed: season.isCompleted,
    lifecycle_status: season.lifecycleStatus,
  };
}

export function registerSeasonRoutes(app: FastifyInstance, { data }: RouteContext): void {
  // The season payload is cached, but its clock is not: countdowns sync to server_now_utc.
  app.get("/api/competitive-season/current", async (_request, reply) => {
    reply.header("Cache-Control", NO_STORE);
    const cached = await data.publicData.get(COMPETITIVE_SEASON_KEY);
    return reply
      .header("X-Data-Cache", cached.cacheStatus)
      .header("X-Data-Generated-At", cached.generatedAt)
      .send({
        server_now_utc: new Date(data.now()).toISOString(),
        season: seasonJson((cached.payload as Partial<SeasonStatus> | null)?.season),
      });
  });
}
