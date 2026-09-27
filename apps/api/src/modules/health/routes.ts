import type { FastifyInstance } from "fastify";
import type { RouteContext } from "../../http/route-context.ts";

// Deploy checks require { status: "ok", source: "mssql" } from production.
export function registerHealthRoutes(app: FastifyInstance, { data }: RouteContext): void {
  app.get("/api/health", async (request, reply) => {
    const healthy = await data.healthCheck().then(
      () => true,
      (err: unknown) => {
        request.log.error({ err }, "[health] Database check failed");
        return false;
      },
    );
    if (healthy) return reply.send({ status: "ok", source: data.source });
    return reply.code(503).send({ status: "error", source: data.source, error: "Database unavailable." });
  });
}
