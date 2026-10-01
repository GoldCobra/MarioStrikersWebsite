// The signed-in player's own profile: reading it, creating it when the login could not, and the
// editor's reading and saving of the country and the friend codes. Every route takes the player from the
// signed session only; no request can name another player.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { HttpError } from "../../http/errors.ts";
import { isCrossSiteRequest, rateLimit, sendNoStore, type RouteContext } from "../../http/route-context.ts";
import { SessionManager } from "../auth/session.ts";
import type { PlayerProfile } from "../players/mappers.ts";
import { identityFromSession, toEditableResponse } from "./mappers.ts";

const AUTH_REQUIRED = { error: "Authentication required.", code: "AUTH_REQUIRED" } as const;
const NOT_LINKED = { error: "No linked player profile.", code: "PLAYER_PROFILE_NOT_LINKED" } as const;

function refuseCrossSite(request: FastifyRequest): void {
  if (isCrossSiteRequest(request)) throw new HttpError(403, "FORBIDDEN", "Cross-site request refused.");
}

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
    if (!profile) return sendNoStore(reply, { ...NOT_LINKED, account }, 404);
    return sendNoStore(reply, { account, profile });
  });

  // The login creates the profile; when that failed (database unavailable), the profile page asks again.
  app.post("/api/profile/me", rateLimit(config, 10), async (request, reply) => {
    refuseCrossSite(request);
    const session = sessions?.readSession(request.headers.cookie) ?? null;
    if (!session) return sendNoStore(reply, AUTH_REQUIRED, 401);
    const player = await data.profiles.ensurePlayer(identityFromSession(session));
    return sendNoStore(reply, { player_id: player.playerId, created: player.created });
  });

  app.get("/api/profile/me/editable", rateLimit(config, 60), async (request, reply) => {
    const session = sessions?.readSession(request.headers.cookie) ?? null;
    if (!session) return sendNoStore(reply, AUTH_REQUIRED, 401);
    const profile = await data.profiles.getEditableProfile(identityFromSession(session));
    if (!profile) return sendNoStore(reply, NOT_LINKED, 404);
    return sendNoStore(reply, toEditableResponse(profile));
  });

  app.put("/api/profile/me/editable", rateLimit(config, 20), async (request, reply) => {
    refuseCrossSite(request);
    if (!(request.headers["content-type"] ?? "").startsWith("application/json")) {
      throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the profile as JSON.");
    }
    const session = sessions?.readSession(request.headers.cookie) ?? null;
    if (!session) return sendNoStore(reply, AUTH_REQUIRED, 401);
    const outcome = await data.profiles.saveEditableProfile(identityFromSession(session), request.body);
    switch (outcome.kind) {
      case "saved":
        return sendNoStore(reply, { ...toEditableResponse(outcome.profile), changed: outcome.changed });
      case "invalid":
        return sendNoStore(
          reply,
          { error: "Some fields are not valid.", code: "VALIDATION_FAILED", fields: outcome.errors },
          400,
        );
      case "taken":
        return sendNoStore(
          reply,
          {
            error: "A friend code is already saved on another profile.",
            code: "FRIEND_CODE_TAKEN",
            fields: outcome.errors,
          },
          409,
        );
      case "conflict":
        return sendNoStore(
          reply,
          {
            error: "The profile was changed elsewhere since it was loaded.",
            code: "PROFILE_CHANGED",
            current: toEditableResponse(outcome.current),
          },
          409,
        );
      case "not_member":
        return sendNoStore(
          reply,
          { error: "Only members of the Discord server can change their profile.", code: "NOT_GUILD_MEMBER" },
          403,
        );
    }
  });
}
