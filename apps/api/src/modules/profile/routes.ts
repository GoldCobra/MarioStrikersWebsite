// The signed-in player's own profile: reading it, and creating it when the login could not.

import type { FastifyInstance } from "fastify";
import { HttpError } from "../../http/errors.ts";
import { isCrossSiteRequest, rateLimit, sendNoStore, type RouteContext } from "../../http/route-context.ts";
import { SessionManager } from "../auth/session.ts";
import type { PlayerProfile } from "../players/mappers.ts";
import { identityFromSession } from "./mappers.ts";

const AUTH_REQUIRED = { error: "Authentication required.", code: "AUTH_REQUIRED" } as const;

export function registerProfileRoutes(app: FastifyInstance, { config, data }: RouteContext): void {
  const sessions = data.login?.sessions ?? null;

  app.get("/api/profile/me", rateLimit(config, 60), async (request, reply) => {
    const session = sessions?.readSession(request.headers.cookie) ?? null;
    if (!session) return sendNoStore(reply, AUTH_REQUIRED, 401);
    const me = SessionManager.toAuthMeResponse(session);
    const account = me.authenticated ? me.user : null;
    let profile: PlayerProfile | null;
    try {
      profile = await data.getPlayerProfileByDiscordId(session.discord_user_id);
    } catch (error) {
      if (error instanceof HttpError && error.code === "PLAYER_PROFILE_CONFLICT") {
        return sendNoStore(reply, { error: error.message, code: error.code, account }, 409);
      }
      throw error;
    }
    if (!profile) {
      return sendNoStore(
        reply,
        { error: "No linked player profile.", code: "PLAYER_PROFILE_NOT_LINKED", account },
        404,
      );
    }
    return sendNoStore(reply, { account, profile });
  });

  // The login creates the profile; when that failed (database unavailable), the profile page asks again.
  app.post("/api/profile/me", rateLimit(config, 10), async (request, reply) => {
    if (isCrossSiteRequest(request)) throw new HttpError(403, "FORBIDDEN", "Cross-site request refused.");
    const session = sessions?.readSession(request.headers.cookie) ?? null;
    if (!session) return sendNoStore(reply, AUTH_REQUIRED, 401);
    const player = await data.profiles.ensurePlayer(identityFromSession(session));
    return sendNoStore(reply, { player_id: player.playerId, created: player.created });
  });
}
