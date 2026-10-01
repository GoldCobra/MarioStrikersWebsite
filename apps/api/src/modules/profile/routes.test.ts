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
          getEditableProfile: () => Promise.resolve(null),
          saveEditableProfile: () => Promise.reject(new Error("unused")),
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

/** A session of the simulated linked or unlinked login against the fixtures. */
async function fixtureLogin(code: "sample" | "sample-unlinked" = "sample") {
  const { app } = await createTestApp();
  const start = await app.inject("/api/auth/discord/start?returnTo=%2Fprofile");
  const stateCookie = cookiePair(setCookies(start.headers["set-cookie"])[0] ?? "");
  const location = String(start.headers.location).replace("code=sample&", `code=${code}&`);
  const callback = await app.inject({ url: location, headers: { cookie: stateCookie } });
  const session = setCookies(callback.headers["set-cookie"]).find((value) => value.startsWith("msc_dev_session="));
  return { app, cookie: cookiePair(session ?? "") };
}

interface Editable {
  version: string;
  discord: { server_name: string; username: string; membership: string; source: string };
  country: string;
  switch_code: string;
  msc_codes: { region: string; platform: string; code: string }[];
  countries: { code: string; name: string }[];
}

const JSON_HEADERS = { "content-type": "application/json" };
const EDITABLE_URL = "/api/profile/me/editable";

test("the editor's profile carries the Discord names, the codes and the offered countries", async () => {
  const { app, cookie } = await fixtureLogin();
  const response = await app.inject({ url: EDITABLE_URL, headers: { cookie } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  const body = response.json<Editable>();
  assert.equal(body.discord.server_name, "[SMP] Sample Player");
  assert.equal(body.discord.username, "sample_player");
  assert.equal(body.discord.source, "live");
  assert.equal(body.country, "de");
  assert.match(body.switch_code, /^\d{4}-\d{4}-\d{4}$/);
  assert.deepEqual(
    body.msc_codes.map((entry) => [entry.region, entry.platform]),
    [["PAL", "Wii"]],
  );
  const codes = body.countries.map((country) => country.code);
  assert.ok(codes.includes("england") && codes.includes("de"));
  assert.ok(!codes.includes("eu") && !codes.includes("rocci"));
  assert.equal((await app.inject(EDITABLE_URL)).statusCode, 401);
});

test("a save changes the member's own profile only, keeps leading zeros and is idempotent", async () => {
  const { app, cookie } = await fixtureLogin();
  const before = (await app.inject({ url: EDITABLE_URL, headers: { cookie } })).json<Editable>();
  const payload = {
    version: before.version,
    player_id: 2,
    country: "scotland",
    switch_code: before.switch_code,
    msc_codes: [...before.msc_codes, { region: "NTSC", platform: "Dolphin", code: "0000-0000-0001" }],
  };
  const put = () => app.inject({ method: "PUT", url: EDITABLE_URL, headers: { cookie, ...JSON_HEADERS }, payload });
  const saved = await put();
  assert.equal(saved.statusCode, 200);
  const after = saved.json<Editable & { changed: boolean }>();
  assert.equal(after.changed, true);
  assert.equal(after.country, "scotland");
  assert.deepEqual(after.msc_codes.at(-1), { region: "NTSC", platform: "Dolphin", code: "0000-0000-0001" });
  assert.notEqual(after.version, before.version);

  // The profile page shows it; player_id in the body changed nothing about whose profile it is.
  const profile = (await app.inject({ url: "/api/profile/me", headers: { cookie } })).json<{
    profile: { player: { id: number; country: string }; friend_codes: { msc: string[] } };
  }>();
  assert.equal(profile.profile.player.id, 1);
  assert.equal(profile.profile.player.country, "gb-sct");
  assert.ok(profile.profile.friend_codes.msc.includes("NTSC-U (Dolphin): 0000-0000-0001"));

  const again = await put();
  assert.equal(again.statusCode, 200);
  assert.equal(again.json<{ changed: boolean }>().changed, false);
});

test("an outdated editor is answered with the current profile instead of overwriting it", async () => {
  const { app, cookie } = await fixtureLogin();
  const before = (await app.inject({ url: EDITABLE_URL, headers: { cookie } })).json<Editable>();
  const put = (payload: Record<string, unknown>) =>
    app.inject({ method: "PUT", url: EDITABLE_URL, headers: { cookie, ...JSON_HEADERS }, payload });
  await put({ ...before, country: "us" });
  const stale = await put({ ...before, country: "fr" });
  assert.equal(stale.statusCode, 409);
  const body = stale.json<{ code: string; current: Editable }>();
  assert.equal(body.code, "PROFILE_CHANGED");
  assert.equal(body.current.country, "us");
});

test("invalid and taken codes are refused with the fields they concern", async () => {
  const { app, cookie } = await fixtureLogin();
  const before = (await app.inject({ url: EDITABLE_URL, headers: { cookie } })).json<Editable>();
  const put = (payload: Record<string, unknown>) =>
    app.inject({ method: "PUT", url: EDITABLE_URL, headers: { cookie, ...JSON_HEADERS }, payload });

  const incomplete = await put({ ...before, switch_code: "1234-5678-901" });
  assert.equal(incomplete.statusCode, 400);
  assert.deepEqual(incomplete.json<{ fields: unknown[] }>().fields, [
    {
      field: "switch_code",
      code: "INCOMPLETE",
      message: "Enter all 12 digits (4 in each field).",
    },
  ]);

  const other = (await app.inject("/api/players/2/profile")).json<{ friend_codes: { switch: string[] } }>();
  const takenCode = (other.friend_codes.switch[0] ?? "").replace(/^SW-/, "");
  const taken = await put({ ...before, switch_code: takenCode });
  assert.equal(taken.statusCode, 409);
  const body = taken.json<{ code: string; fields: { field: string; code: string }[] }>();
  assert.equal(body.code, "FRIEND_CODE_TAKEN");
  assert.deepEqual(
    body.fields.map((field) => `${field.field}:${field.code}`),
    ["switch_code:TAKEN"],
  );
});

test("saves need JSON, a same-site page and a session", async () => {
  const { app, cookie } = await fixtureLogin();
  const text = await app.inject({
    method: "PUT",
    url: EDITABLE_URL,
    headers: { cookie, "content-type": "text/plain" },
    payload: "{}",
  });
  assert.equal(text.statusCode, 415);
  const crossSite = await app.inject({
    method: "PUT",
    url: EDITABLE_URL,
    headers: { cookie, ...JSON_HEADERS, host: "mariostrikers.gg", origin: "https://evil.example" },
    payload: {},
  });
  assert.equal(crossSite.statusCode, 403);
  const anonymous = await app.inject({ method: "PUT", url: EDITABLE_URL, headers: JSON_HEADERS, payload: {} });
  assert.equal(anonymous.statusCode, 401);
});

test("a former member's save is refused, and a member without a profile has nothing to edit", async () => {
  let sessions: SessionManager | undefined;
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
          ensurePlayer: () => Promise.resolve({ playerId: 42, created: false }),
          getEditableProfile: () => Promise.resolve(null),
          saveEditableProfile: () => Promise.resolve({ kind: "not_member" as const }),
        },
      };
    },
  });
  assert.ok(sessions);
  const cookie = cookiePair(sessions.createSessionCookie({ id: "123", username: "tester" }));
  const response = await app.inject({
    method: "PUT",
    url: EDITABLE_URL,
    headers: { cookie, ...JSON_HEADERS },
    payload: {},
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json<{ code: string }>().code, "NOT_GUILD_MEMBER");
  const missing = await app.inject({ url: EDITABLE_URL, headers: { cookie } });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json<{ code: string }>().code, "PLAYER_PROFILE_NOT_LINKED");
});
