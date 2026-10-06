// Discord login and the current account. The login also creates the player profile of a member who has
// none yet; the profile itself is served by modules/profile. For a confirmed admin the account carries
// the admin page's link (docs/adr/0011); for everyone else the answer stays exactly as it was.

import type { FastifyInstance } from "fastify";
import { HttpError } from "../../http/errors.ts";
import { isCrossSiteRequest, rateLimit, sendNoStore, type RouteContext } from "../../http/route-context.ts";
import { createAdminGuard, hasAdminRole } from "../admin/guard.ts";
import { identityFromLogin } from "../profile/mappers.ts";
import { NotGuildMemberError, type DiscordLogin } from "./discord-oauth.ts";
import { SessionManager } from "./session.ts";
import { DEFAULT_RETURN_TO, appendQuery, normalizeReturnTo, serializeCookie } from "./tokens.ts";

export function registerAuthRoutes(app: FastifyInstance, { config, data }: RouteContext): void {
  const limit = rateLimit(config, 30);
  const sessions = data.login?.sessions ?? null;
  const adminGuard = createAdminGuard(data);
  const adminRoleIds = data.admin?.settings.roleIds ?? [];

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
      let login: DiscordLogin;
      try {
        login = await oauth.completeLogin(code);
      } catch (err) {
        const notMember = err instanceof NotGuildMemberError;
        if (!notMember) request.log.error({ err }, "[auth] Discord login failed");
        return reply
          .header("Set-Cookie", clearState)
          .redirect(appendQuery(verified.returnTo, { auth: notMember ? "not_member" : "failed" }), 302);
      }
      // A member without a player profile gets one now. A failure (database unavailable) does not stop
      // the login: the profile page asks for the profile again.
      try {
        await data.profiles.ensurePlayer(identityFromLogin(login));
      } catch (err) {
        request.log.error({ err }, "[auth] Player profile could not be created at login");
      }
      // An admin role at login marks the session, so only those members are ever checked live later.
      const adminCandidate = adminGuard !== null && hasAdminRole(login.roles, adminRoleIds);
      return reply
        .header("Set-Cookie", [clearState, manager.createSessionCookie(login.user, login.nick, { adminCandidate })])
        .redirect(appendQuery(verified.returnTo, { auth: "success" }), 302);
    },
  );

  app.get("/api/auth/me", async (request, reply) => {
    const adminCheck = adminGuard ? await adminGuard.check(request.headers.cookie) : null;
    return sendNoStore(reply, {
      ...SessionManager.toAuthMeResponse(sessions?.readSession(request.headers.cookie) ?? null),
      login_available: data.login !== null,
      // Only a confirmed admin gets the link; the menu renders whatever links the account carries.
      ...(adminGuard && adminCheck?.ok ? { account_links: [{ label: "Admin", href: adminGuard.pagePath }] } : {}),
    });
  });

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
}
