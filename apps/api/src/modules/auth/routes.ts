// Discord login, the current account and the linked player profile.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { HttpError } from "../../http/errors.ts";
import { rateLimit, sendNoStore, type RouteContext } from "../../http/route-context.ts";
import type { PlayerProfile } from "../players/mappers.ts";
import { NotGuildMemberError } from "./discord-oauth.ts";
import { SessionManager, type DiscordUser } from "./session.ts";
import { DEFAULT_RETURN_TO, appendQuery, normalizeReturnTo, serializeCookie } from "./tokens.ts";

/**
 * A logout from another site's page is refused; same-site requests and non-browser clients pass.
 * Host names are compared without ports, because nginx forwards the host without its port.
 */
function isCrossSiteRequest(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).hostname !== new URL(`http://${request.headers.host ?? ""}`).hostname;
  } catch {
    return true;
  }
}

export function registerAuthRoutes(app: FastifyInstance, { config, data }: RouteContext): void {
  const limit = rateLimit(config, 30);
  const sessions = data.login?.sessions ?? null;

  app.get<{ Querystring: { returnTo?: unknown } }>("/api/auth/discord/start", limit, async (request, reply) => {
    const returnTo = normalizeReturnTo(request.query.returnTo);
    if (!data.login) return reply.redirect(appendQuery(returnTo, { auth: "unavailable" }), 302);
    const { state, cookie } = data.login.sessions.createOAuthState(returnTo);
    return reply.header("Set-Cookie", cookie).redirect(data.login.oauth.authorizeUrl(state), 302);
  });

  app.get<{ Querystring: { code?: unknown; state?: unknown } }>(
    "/api/auth/discord/callback",
    limit,
    async (request, reply) => {
      if (!data.login) return reply.redirect(appendQuery(DEFAULT_RETURN_TO, { auth: "unavailable" }), 302);
      const { oauth, sessions: manager } = data.login;
      const clearState = manager.clearOAuthStateCookie();
      const verified = manager.verifyOAuthState(request.query.state, request.headers.cookie);
      if (!verified) {
        return reply.header("Set-Cookie", clearState).redirect(appendQuery(DEFAULT_RETURN_TO, { auth: "failed" }), 302);
      }
      const code = typeof request.query.code === "string" ? request.query.code.trim() : "";
      if (!code) {
        return reply.header("Set-Cookie", clearState).redirect(appendQuery(verified.returnTo, { auth: "failed" }), 302);
      }
      let user: DiscordUser;
      try {
        user = await oauth.completeLogin(code);
      } catch (err) {
        const notMember = err instanceof NotGuildMemberError;
        if (!notMember) request.log.error({ err }, "[auth] Discord login failed");
        return reply
          .header("Set-Cookie", clearState)
          .redirect(appendQuery(verified.returnTo, { auth: notMember ? "not_member" : "failed" }), 302);
      }
      return reply
        .header("Set-Cookie", [clearState, manager.createSessionCookie(user)])
        .redirect(appendQuery(verified.returnTo, { auth: "success" }), 302);
    },
  );

  app.get("/api/auth/me", async (request, reply) =>
    sendNoStore(reply, SessionManager.toAuthMeResponse(sessions?.readSession(request.headers.cookie) ?? null)),
  );

  app.post("/api/auth/logout", limit, async (request, reply) => {
    if (isCrossSiteRequest(request)) throw new HttpError(403, "FORBIDDEN", "Cross-site request refused.");
    const clear =
      sessions?.clearSessionCookie() ??
      serializeCookie(config.session.cookieName, "", {
        maxAgeSeconds: 0,
        expires: new Date(0),
        path: "/",
        secure: config.session.cookieSecure,
      });
    return sendNoStore(reply.header("Set-Cookie", clear), { ok: true });
  });

  app.get("/api/profile/me", rateLimit(config, 60), async (request, reply) => {
    const session = sessions?.readSession(request.headers.cookie) ?? null;
    if (!session) return sendNoStore(reply, { error: "Authentication required.", code: "AUTH_REQUIRED" }, 401);
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
}
