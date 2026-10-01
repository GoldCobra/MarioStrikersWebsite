import assert from "node:assert/strict";
import test from "node:test";
import type { Config } from "../../config.ts";
import { HttpError } from "../../http/errors.ts";
import { cookiePair, createTestApp, setCookies } from "../../test-support/app.ts";
import { DISCORD_TEST_ENV } from "../../test-support/fake-discord.ts";
import { SessionManager } from "../auth/session.ts";
import type { PlayerProfile } from "../players/mappers.ts";
import type { DiscordIdentity } from "./mappers.ts";
import type { ProfileService } from "./service.ts";

async function createProfileApp({
  profile,
  ensure = () => Promise.resolve({ playerId: 42, created: false }),
}: {
  profile?: (discordId: string) => Promise<PlayerProfile | null>;
  ensure?: ProfileService["ensurePlayer"];
} = {}) {
  let sessions: SessionManager | undefined;
  const ensured: DiscordIdentity[] = [];
  const { app } = await createTestApp({
    env: DISCORD_TEST_ENV,
    data: (config: Config) => {
      sessions = new SessionManager({ ...config.session, now: Date.now });
      return {
        login: {
          sessions,
          oauth: { authorizeUrl: () => "", completeLogin: () => Promise.reject(new Error("unused")) },
        },
        profiles: {
          ensurePlayer: (identity) => {
            ensured.push(identity);
            return ensure(identity);
          },
        },
        ...(profile ? { getPlayerProfileByDiscordId: profile } : {}),
      };
    },
  });
  assert.ok(sessions);
  const cookie = cookiePair(
    sessions.createSessionCookie({ id: "123", username: "tester", global_name: "Tester" }, "Nick"),
  );
  return { app, cookie, ensured };
}

test("/api/profile/me requires a session", async () => {
  const { app } = await createProfileApp();
  const response = await app.inject("/api/profile/me");
  assert.equal(response.statusCode, 401);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(response.json(), { error: "Authentication required.", code: "AUTH_REQUIRED" });
});

test("/api/profile/me reports an account without a player", async () => {
  const { app, cookie } = await createProfileApp({ profile: () => Promise.resolve(null) });
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
  const { app, cookie } = await createProfileApp({
    profile: (discordId) => {
      assert.equal(discordId, "123");
      return Promise.resolve(profile);
    },
  });
  const response = await app.inject({ url: "/api/profile/me", headers: { cookie } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  const body = response.json<{ account: { id: string }; profile: { player: { name: string; club_id: number } } }>();
  assert.equal(body.account.id, "123");
  assert.equal(body.profile.player.name, "GoldCobra");
  assert.equal(body.profile.player.club_id, 8);
});

test("/api/profile/me fails closed on duplicate Discord profile links", async () => {
  const { app, cookie } = await createProfileApp({
    profile: () =>
      Promise.reject(
        new HttpError(409, "PLAYER_PROFILE_CONFLICT", "Multiple player profiles match this Discord account."),
      ),
  });
  const response = await app.inject({ url: "/api/profile/me", headers: { cookie } });
  assert.equal(response.statusCode, 409);
  const body = response.json<{ code: string; account: { id: string } }>();
  assert.equal(body.code, "PLAYER_PROFILE_CONFLICT");
  assert.equal(body.account.id, "123");
});

test("POST /api/profile/me creates the signed-in member's profile", async () => {
  const { app, cookie, ensured } = await createProfileApp({
    ensure: () => Promise.resolve({ playerId: 1124, created: true }),
  });
  const response = await app.inject({ method: "POST", url: "/api/profile/me", headers: { cookie } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(response.json(), { player_id: 1124, created: true });
  assert.deepEqual(ensured, [{ id: "123", username: "tester", globalName: "Tester", nick: "Nick" }]);
});

test("POST /api/profile/me refuses anonymous and cross-site requests", async () => {
  const { app, cookie, ensured } = await createProfileApp();
  const anonymous = await app.inject({ method: "POST", url: "/api/profile/me" });
  assert.equal(anonymous.statusCode, 401);
  assert.equal(anonymous.json<{ code: string }>().code, "AUTH_REQUIRED");
  const crossSite = await app.inject({
    method: "POST",
    url: "/api/profile/me",
    headers: { cookie, host: "mariostrikers.gg", origin: "https://evil.example" },
  });
  assert.equal(crossSite.statusCode, 403);
  assert.equal(crossSite.json<{ code: string }>().code, "FORBIDDEN");
  assert.deepEqual(ensured, []);
});

test("the simulated login gives a Discord user without a profile a new one", async () => {
  const { app } = await createTestApp();
  const start = await app.inject("/api/auth/discord/start?returnTo=%2Fprofile");
  const stateCookie = cookiePair(setCookies(start.headers["set-cookie"])[0] ?? "");
  const location = String(start.headers.location).replace("code=sample&", "code=sample-unlinked&");
  const callback = await app.inject({ url: location, headers: { cookie: stateCookie } });
  assert.equal(callback.headers.location, "/profile?auth=success");
  const session = setCookies(callback.headers["set-cookie"]).find((value) => value.startsWith("msc_dev_session="));
  const me = await app.inject({ url: "/api/profile/me", headers: { cookie: cookiePair(session ?? "") } });
  assert.equal(me.statusCode, 200);
  const body = me.json<{ profile: { player: { id: number; name: string } } }>();
  assert.deepEqual(body.profile.player.name, "Unlinked Sample");
  assert.equal(body.profile.player.id, 49);
  // A second login reuses the profile.
  const again = await app.inject({
    method: "POST",
    url: "/api/profile/me",
    headers: { cookie: cookiePair(session ?? "") },
  });
  assert.deepEqual(again.json(), { player_id: 49, created: false });
});
