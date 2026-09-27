import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type { Config } from "../../config.ts";
import { HttpError } from "../../http/errors.ts";
import { cookiePair, createTestApp, setCookies, tamper } from "../../test-support/app.ts";
import { DISCORD_TEST_ENV, DISCORD_TEST_USER, createFakeDiscordFetch } from "../../test-support/fake-discord.ts";
import type { PlayerProfile } from "../players/mappers.ts";
import { createDiscordOAuthClient } from "./discord-oauth.ts";
import { OAUTH_STATE_COOKIE, SessionManager } from "./session.ts";

interface LoginApp {
  app: FastifyInstance;
  sessions: SessionManager;
}

async function createLoginApp({
  member = true,
  profile,
}: { member?: boolean; profile?: (discordId: string) => Promise<PlayerProfile | null> } = {}): Promise<LoginApp> {
  let sessions: SessionManager | undefined;
  const { app } = await createTestApp({
    env: DISCORD_TEST_ENV,
    data: (config: Config) => {
      sessions = new SessionManager({ ...config.session, now: Date.now });
      return {
        login: { sessions, oauth: createDiscordOAuthClient(config.discord, createFakeDiscordFetch({ member }).fetch) },
        ...(profile ? { getPlayerProfileByDiscordId: profile } : {}),
      };
    },
  });
  assert.ok(sessions);
  return { app, sessions };
}

/** Starts a login and returns the state from Discord's authorize URL with this browser's nonce cookie. */
async function startLogin(
  app: FastifyInstance,
  returnTo = "/profile",
): Promise<{ state: string; stateCookie: string }> {
  const response = await app.inject(`/api/auth/discord/start?returnTo=${encodeURIComponent(returnTo)}`);
  assert.equal(response.statusCode, 302);
  const location = new URL(String(response.headers.location));
  assert.equal(location.origin, "https://discord.com");
  const [stateCookie = ""] = setCookies(response.headers["set-cookie"]);
  assert.ok(stateCookie.startsWith(`${OAUTH_STATE_COOKIE}=`));
  return { state: location.searchParams.get("state") ?? "", stateCookie: cookiePair(stateCookie) };
}

function callback(app: FastifyInstance, state: string, cookie?: string) {
  return app.inject({
    url: `/api/auth/discord/callback?code=abc&state=${encodeURIComponent(state)}`,
    headers: cookie ? { cookie } : {},
  });
}

test("Discord callback creates a signed session for server members", async () => {
  const { app } = await createLoginApp();
  const { state, stateCookie } = await startLogin(app, "/players#top");
  const response = await callback(app, state, stateCookie);
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, "/players?auth=success#top");
  const [clearState, session] = setCookies(response.headers["set-cookie"]);
  assert.match(clearState ?? "", new RegExp(`^${OAUTH_STATE_COOKIE}=; Max-Age=0`));
  assert.match(session ?? "", /^msc_session=/);

  const me = (await app.inject({ url: "/api/auth/me", headers: { cookie: cookiePair(session ?? "") } })).json<{
    authenticated: boolean;
    user: { id: string; global_name: string };
  }>();
  assert.equal(me.authenticated, true);
  assert.equal(me.user.id, DISCORD_TEST_USER.id);
  assert.equal(me.user.global_name, "GoldCobra");
});

test("Discord callback rejects non-members without a session", async () => {
  const { app } = await createLoginApp({ member: false });
  const { state, stateCookie } = await startLogin(app);
  const response = await callback(app, state, stateCookie);
  assert.equal(response.headers.location, "/profile?auth=not_member");
  assert.deepEqual(
    setCookies(response.headers["set-cookie"]).map((cookie) => cookie.split("=")[0]),
    [OAUTH_STATE_COOKIE],
  );
});

test("invalid, forged and cross-browser OAuth states are rejected", async () => {
  const { app } = await createLoginApp();
  const { state, stateCookie } = await startLogin(app);
  const other = await startLogin(app);
  for (const [attempt, cookie] of [
    ["bad", stateCookie],
    [tamper(state), stateCookie],
    // Login CSRF: a state from another browser's login does not match this browser's nonce.
    [state, undefined],
    [state, other.stateCookie],
  ] as const) {
    const response = await callback(app, attempt, cookie);
    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.location, "/profile?auth=failed");
    assert.ok(!setCookies(response.headers["set-cookie"]).some((value) => value.startsWith("msc_session=")));
  }
});

test("login reports unavailable when Discord is not configured", async () => {
  const { app } = await createTestApp({ data: { login: null } });
  const start = await app.inject("/api/auth/discord/start?returnTo=%2Fplayers");
  assert.equal(start.headers.location, "/players?auth=unavailable");
  const callbackResponse = await app.inject("/api/auth/discord/callback?code=abc&state=x");
  assert.equal(callbackResponse.headers.location, "/profile?auth=unavailable");
  assert.deepEqual((await app.inject("/api/auth/me")).json(), { authenticated: false });
});

test("tampered and malformed session cookies are treated as logged out", async () => {
  const { app, sessions } = await createLoginApp();
  const cookie = cookiePair(sessions.createSessionCookie({ id: "123", username: "tester" }));
  for (const value of [tamper(cookie), "msc_session=%", "msc_session=%E0%A4%A", "msc_session=invalid"]) {
    const response = await app.inject({ url: "/api/auth/me", headers: { cookie: value } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(response.json(), { authenticated: false });
  }
  // Undecodable cookies of other applications do not invalidate a valid session.
  for (const value of [`unrelated=%; ${cookie}`, `${cookie}; unrelated=%E0%A4%A`]) {
    const me = (await app.inject({ url: "/api/auth/me", headers: { cookie: value } })).json<{
      authenticated: boolean;
    }>();
    assert.equal(me.authenticated, true);
  }
});

test("logout clears the session and refuses cross-site requests", async () => {
  const { app, sessions } = await createLoginApp();
  const cookie = cookiePair(sessions.createSessionCookie({ id: "123", username: "tester" }));
  const crossSite = await app.inject({
    method: "POST",
    url: "/api/auth/logout",
    headers: { cookie, host: "mariostrikers.gg", origin: "https://evil.example" },
  });
  assert.equal(crossSite.statusCode, 403);
  assert.equal(crossSite.json<{ code: string }>().code, "FORBIDDEN");
  assert.equal(crossSite.headers["set-cookie"], undefined);

  for (const headers of [
    { cookie },
    { cookie, host: "mariostrikers.gg", origin: "https://mariostrikers.gg" },
    { cookie, host: "127.0.0.1", origin: "http://127.0.0.1:8080" },
  ]) {
    const response = await app.inject({ method: "POST", url: "/api/auth/logout", headers });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ok: true });
    assert.match(String(response.headers["set-cookie"]), /^msc_session=; Max-Age=0; Expires=Thu, 01 Jan 1970/);
  }
});

test("/api/profile/me requires a session", async () => {
  const { app } = await createLoginApp();
  const response = await app.inject("/api/profile/me");
  assert.equal(response.statusCode, 401);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(response.json(), { error: "Authentication required.", code: "AUTH_REQUIRED" });
});

test("/api/profile/me returns a no-profile state for linked Discord accounts without a player", async () => {
  const { app, sessions } = await createLoginApp({ profile: () => Promise.resolve(null) });
  const cookie = cookiePair(sessions.createSessionCookie({ id: "123", username: "tester" }));
  const response = await app.inject({ url: "/api/profile/me", headers: { cookie } });
  assert.equal(response.statusCode, 404);
  const body = response.json<{ code: string; account: { id: string } }>();
  assert.equal(body.code, "PLAYER_PROFILE_NOT_LINKED");
  assert.equal(body.account.id, "123");
});

test("/api/profile/me returns profile data for the authenticated Discord account", async () => {
  const profile = {
    player: { id: 42, name: "GoldCobra", country: "us", club_id: 8, club_name: "Chaos Edge", club_tag: "CE" },
    friend_codes: {},
    accolades: [],
    ratings: {},
  } as unknown as PlayerProfile;
  const { app, sessions } = await createLoginApp({
    profile: (discordId) => {
      assert.equal(discordId, "123");
      return Promise.resolve(profile);
    },
  });
  const cookie = cookiePair(sessions.createSessionCookie({ id: "123", username: "tester" }));
  const response = await app.inject({ url: "/api/profile/me", headers: { cookie } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  const body = response.json<{ account: { id: string }; profile: { player: { name: string; club_id: number } } }>();
  assert.equal(body.account.id, "123");
  assert.equal(body.profile.player.name, "GoldCobra");
  assert.equal(body.profile.player.club_id, 8);
});

test("/api/profile/me fails closed on duplicate Discord profile links", async () => {
  const { app, sessions } = await createLoginApp({
    profile: () =>
      Promise.reject(
        new HttpError(409, "PLAYER_PROFILE_CONFLICT", "Multiple player profiles match this Discord account."),
      ),
  });
  const cookie = cookiePair(sessions.createSessionCookie({ id: "123", username: "tester" }));
  const response = await app.inject({ url: "/api/profile/me", headers: { cookie } });
  assert.equal(response.statusCode, 409);
  const body = response.json<{ code: string; account: { id: string } }>();
  assert.equal(body.code, "PLAYER_PROFILE_CONFLICT");
  assert.equal(body.account.id, "123");
});
