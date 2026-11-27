// The Recharged API (docs/adr/0016, docs/recharged-api.md): MSC rated for the Recharged WFC server, behind its keys.
// Without RECHARGED_API_KEYS none of these routes exists (an unknown path's 404); a wrong setting is logged and keeps
// them off instead of stopping the API. With keys, every route needs one ("Authorization: Bearer <key>", 401
// otherwise), checked in the scope's first hook, so a route added later cannot skip it. Limits count per key, after
// that check. A test key's reports are kept apart from a live key's and are never rated.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Config } from "../../config.ts";
import { NO_STORE } from "../../http/cache-control.ts";
import { HttpError, badRequest } from "../../http/errors.ts";
import { sendNoStore, type RouteContext } from "../../http/route-context.ts";
import { findApiKey, parseApiKeys, type ApiKey } from "./keys.ts";
import {
  DISCORD_ID,
  MATCH_ID,
  submitMatchReport,
  toPlayerResponse,
  toRanksResponse,
  toReportResponse,
} from "./service.ts";

export const RECHARGED_API_PREFIX = "/api/recharged/v1";

export function registerRechargedRoutes(app: FastifyInstance, { config, data }: RouteContext): void {
  const { keys, problems } = parseApiKeys(config.recharged.apiKeys);
  if (problems.length) {
    app.log.error({ settings: problems }, "[recharged] RECHARGED_API_KEYS is set, but the Recharged API stays off");
    return;
  }
  if (!keys.length) return;
  const store = data.recharged;
  const presented = new WeakMap<FastifyRequest, ApiKey>();

  function keyOf(request: FastifyRequest): ApiKey {
    const key = presented.get(request);
    if (!key) throw new HttpError(401, "INVALID_API_KEY", "A valid API key is required.");
    return key;
  }

  /** Per key (not per address), after the key check. */
  function keyRateLimit(settings: Config, max: number) {
    if (!settings.rateLimitEnabled) return {};
    return {
      config: {
        rateLimit: {
          max,
          timeWindow: 60_000,
          hook: "preHandler" as const,
          keyGenerator: (request: FastifyRequest) => {
            const key = presented.get(request);
            return key ? `recharged:${key.digest.toString("hex", 0, 8)}` : request.ip;
          },
        },
      },
    };
  }

  app.register(
    (recharged, _options, done) => {
      recharged.addHook("onRequest", async (request, reply) => {
        const key = findApiKey(request.headers.authorization, keys);
        if (!key) {
          return reply
            .code(401)
            .header("WWW-Authenticate", 'Bearer realm="recharged"')
            .header("Cache-Control", NO_STORE)
            .send({ error: "A valid API key is required.", code: "INVALID_API_KEY" });
        }
        presented.set(request, key);
      });

      recharged.get<{ Params: { discordId: string } }>(
        "/players/:discordId",
        keyRateLimit(config, 600),
        async (request, reply) => {
          const { discordId } = request.params;
          if (!DISCORD_ID.test(discordId)) throw badRequest("The Discord user id must be 15 to 20 digits.");
          const record = await store.findPlayer(discordId);
          if (!record) throw new HttpError(404, "PLAYER_NOT_FOUND", "No player is linked to this Discord account.");
          return sendNoStore(reply, toPlayerResponse(discordId, record));
        },
      );

      recharged.get("/ranks", keyRateLimit(config, 60), async (_request, reply) =>
        sendNoStore(reply, toRanksResponse(await store.listRanks())),
      );

      recharged.post("/matches", keyRateLimit(config, 120), async (request, reply) => {
        const key = keyOf(request);
        if (!(request.headers["content-type"] ?? "").startsWith("application/json")) {
          throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the report as JSON.");
        }
        const outcome = await submitMatchReport(store, request.body, key.environment, data.now());
        request.log.info(
          { recharged: { environment: key.environment, match_id: outcome.report.matchId, created: outcome.created } },
          "[recharged] Match report",
        );
        return sendNoStore(
          reply,
          { created: outcome.created, report: toReportResponse(outcome.report) },
          outcome.created ? 201 : 200,
        );
      });

      recharged.get<{ Params: { matchId: string } }>(
        "/matches/:matchId",
        keyRateLimit(config, 600),
        async (request, reply) => {
          const key = keyOf(request);
          const { matchId } = request.params;
          if (!MATCH_ID.test(matchId)) {
            throw badRequest("match_id must be 1 to 64 letters, digits or . _ : -, starting with a letter or digit.");
          }
          const report = await store.findReport(key.environment, matchId);
          if (!report) throw new HttpError(404, "MATCH_NOT_FOUND", "No report with this match_id.");
          return sendNoStore(reply, { report: toReportResponse(report) });
        },
      );
      done();
    },
    { prefix: RECHARGED_API_PREFIX },
  );
}
