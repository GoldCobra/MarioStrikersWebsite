import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { Config } from "../../config.ts";
import { UNKNOWN_MEMBER, type GuildMember } from "../../integrations/discord/members.ts";
import { cookiePair, createTestApp, setCookies, tamper } from "../../test-support/app.ts";
import {
  DISCORD_TEST_ADMIN_ROLE,
  DISCORD_TEST_ENV,
  DISCORD_TEST_USER,
  createFakeDiscordFetch,
} from "../../test-support/fake-discord.ts";
import { createDiscordOAuthClient } from "../auth/discord-oauth.ts";
import { OAUTH_STATE_COOKIE, SessionManager } from "../auth/session.ts";
import { createSignedToken } from "../auth/tokens.ts";
import { createMemoryAdminAuditStore } from "./audit.ts";
import type { AdminAccess } from "./guard.ts";
import { ADMIN_GATE_PATH } from "./routes.ts";

const TOKEN = "Zx9-kq_3VtLm0aB7cD1eF2";
const PAGE = `/_/${TOKEN}/`;
const ADMIN_MEMBER: GuildMember = {
  membership: "member",
  nick: "",
  username: "goldcobra",
  globalName: "GoldCobra",
  roles: [DISCORD_TEST_ADMIN_ROLE],
};

interface AdminApp {
  app: FastifyInstance;
  sessions: SessionManager;
  member: { value: GuildMember };
  lookups: string[];
  audit: ReturnType<typeof createMemoryAdminAuditStore>;
  /** A session as a login with (or without) the admin role at that moment would issue it. */
  cookie: (adminCandidate?: boolean) => string;
}

async function createAdminApp({
  adminOn = true,
  loginRoles = [DISCORD_TEST_ADMIN_ROLE] as readonly string[],
} = {}): Promise<AdminApp> {
  let sessions: SessionManager | undefined;
  const member = { value: ADMIN_MEMBER };
  const lookups: string[] = [];
  const audit = createMemoryAdminAuditStore();
  const { app } = await createTestApp({
    // Rate limits on, so the tests also prove that admin routes never show their headers.
    env: { ...DISCORD_TEST_ENV, RATE_LIMIT_ENABLED: "true" },
    data: (config: Config) => {
      sessions = new SessionManager({ ...config.session, now: Date.now });
      const admin: AdminAccess = {
        settings: { roleIds: [DISCORD_TEST_ADMIN_ROLE], pathToken: TOKEN, sessionMaxAgeMs: 12 * 60 * 60 * 1000 },
        members: {
          getMember: (id) => {
            lookups.push(id);
            return Promise.resolve(member.value);
          },
        },
        audit,
      };
      return {
        now: Date.now,
        login: {
          sessions,
          oauth: createDiscordOAuthClient(config.discord, createFakeDiscordFetch({ roles: loginRoles }).fetch),
        },
        admin: adminOn ? admin : null,
        profiles: {
          ensurePlayer: () => Promise.resolve({ playerId: 42, created: false }),
          getEditableProfile: () => Promise.resolve(null),
          saveEditableProfile: () => Promise.reject(new Error("unused")),
        },
      };
    },
  });
  assert.ok(sessions);
  const manager = sessions;
  return {
    app,
    sessions: manager,
    member,
    lookups,
    audit,
    cookie: (adminCandidate = true) =>
      cookiePair(manager.createSessionCookie(DISCORD_TEST_USER, "", { adminCandidate })),
  };
}

function gate(app: FastifyInstance, uri: string, cookie?: string) {
  return app.inject({
    url: ADMIN_GATE_PATH,
    headers: { "x-original-uri": uri, ...(cookie ? { cookie } : {}) },
  });
}

/** Everything a client can see of a response: status, headers and body. */
function visible(response: LightMyRequestResponse) {
  const headers = Object.fromEntries(Object.entries(response.headers).filter(([name]) => name !== "date"));
  return { status: response.statusCode, headers, body: response.body };
}

test("a confirmed admin reads the overview; it shows no rate limit headers", async () => {
  const { app, cookie, audit } = await createAdminApp();
  await audit.record({ discordUserId: "1", action: "page.open", outcome: "allowed", ip: "203.0.113.9" });
  const response = await app.inject({ url: "/api/admin/overview", headers: { cookie: cookie() } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(
    Object.keys(response.headers).some((name) => name.startsWith("x-ratelimit")),
    false,
  );
  const body = response.json<{
    admin: Record<string, string>;
    access_until: string;
    audit: Record<string, string>[];
  }>();
  assert.deepEqual(body.admin, {
    discord_user_id: DISCORD_TEST_USER.id,
    username: "goldcobra",
    global_name: "GoldCobra",
  });
  assert.ok(Date.parse(body.access_until) > Date.now());
  assert.deepEqual(
    body.audit.map((entry) => ({ ...entry, at: Number.isNaN(Date.parse(entry.at ?? "")) ? "invalid" : "date" })),
    [{ at: "date", discord_user_id: "1", action: "page.open", target: "", outcome: "allowed" }],
  );
  // The audit list never carries the address.
  assert.equal(response.body.includes("203.0.113.9"), false);
});

test("every refused admin request looks exactly like an unknown path", async () => {
  const { app, cookie, member, sessions } = await createAdminApp();
  const unknown = visible(await app.inject("/api/admin/does-not-exist"));
  assert.deepEqual(visible(await app.inject("/api/no-such-route")), unknown);
  assert.equal(unknown.status, 404);

  const signed = (issuedAt: number, expiresAt: number): string =>
    `msc_session=${createSignedToken(
      { discord_user_id: DISCORD_TEST_USER.id, adm: true, issued_at: issuedAt, expires_at: expiresAt },
      DISCORD_TEST_ENV.SESSION_SECRET,
    )}`;
  const hour = 60 * 60 * 1000;
  assert.ok(sessions.readSession(signed(Date.now() - hour, Date.now() + hour)));
  const refusals: [string, () => Record<string, string>][] = [
    ["logged out", () => ({})],
    ["session without the claim", () => ({ cookie: cookie(false) })],
    ["tampered session", () => ({ cookie: tamper(cookie()) })],
    ["expired session", () => ({ cookie: signed(Date.now() - 8 * 24 * hour, Date.now() - 1000) })],
    ["admin session too old", () => ({ cookie: signed(Date.now() - 13 * hour, Date.now() + hour) })],
    [
      "role removed",
      () => {
        member.value = { ...ADMIN_MEMBER, roles: ["902508392227176489"] };
        return { cookie: cookie() };
      },
    ],
    [
      "left the server",
      () => {
        member.value = { ...UNKNOWN_MEMBER, membership: "not_member" };
        return { cookie: cookie() };
      },
    ],
    [
      "Discord unreachable",
      () => {
        member.value = UNKNOWN_MEMBER;
        return { cookie: cookie() };
      },
    ],
  ];
  for (const [name, headers] of refusals) {
    for (const url of ["/api/admin/overview", "/API/ADMIN/OVERVIEW/"]) {
      assert.deepEqual(visible(await app.inject({ url, headers: headers() })), unknown, `${name} GET ${url}`);
      // HEAD: the same status and headers; an HTTP server never sends a HEAD body (inject keeps the unknown
      // path's), so the body is not compared.
      const head = visible(await app.inject({ method: "HEAD", url, headers: headers() }));
      const unknownHead = visible(await app.inject({ method: "HEAD", url: "/api/no-such-route" }));
      assert.deepEqual({ ...head, body: "" }, { ...unknownHead, body: "" }, `${name} HEAD ${url}`);
    }
  }
});

test("without the admin page switched on nobody is an admin", async () => {
  const { app, cookie } = await createAdminApp({ adminOn: false });
  assert.deepEqual(
    visible(await app.inject({ url: "/api/admin/overview", headers: { cookie: cookie() } })),
    visible(await app.inject("/api/no-such-route")),
  );
  assert.equal((await gate(app, PAGE, cookie())).statusCode, 401);
  const me = (await app.inject({ url: "/api/auth/me", headers: { cookie: cookie() } })).json<object>();
  assert.equal(Object.hasOwn(me, "account_links"), false);
});

test("nginx's gate opens the page only for an admin with the exact path, and logs the opening once", async () => {
  const { app, cookie, member, audit, lookups } = await createAdminApp();
  const session = cookie();
  const opened = await gate(app, PAGE, session);
  assert.equal(opened.statusCode, 204);
  assert.equal(opened.headers["cache-control"], "no-store");
  for (const file of ["index.html", "assets/admin.js"]) {
    assert.equal((await gate(app, PAGE + file, session)).statusCode, 204);
  }
  assert.equal((await gate(app, `${PAGE}?reload=1`, session)).statusCode, 204);
  // Once per session and day: the same session's reloads and files add nothing.
  assert.deepEqual(
    audit.events.map(({ discordUserId, action, outcome }) => ({ discordUserId, action, outcome })),
    [{ discordUserId: DISCORD_TEST_USER.id, action: "page.open", outcome: "allowed" }],
  );

  // A wrong or missing path is refused before the session is even read.
  const asked = lookups.length;
  for (const uri of ["", "/admin", "/_/", `/_/${TOKEN}`, `/_/${TOKEN}x/`, `/_/x/${TOKEN}/`]) {
    assert.equal((await gate(app, uri, cookie())).statusCode, 401, uri);
  }
  assert.equal(lookups.length, asked);
  for (const headers of [undefined, cookie(false)]) assert.equal((await gate(app, PAGE, headers)).statusCode, 401);
  member.value = { ...ADMIN_MEMBER, roles: [] };
  assert.equal((await gate(app, PAGE, cookie())).statusCode, 401);
  assert.equal(audit.events.length, 1);
});

test("only a confirmed admin's account carries the admin link", async () => {
  const { app, cookie, member, lookups } = await createAdminApp();
  const me = async (sessionCookie?: string) =>
    (await app.inject({ url: "/api/auth/me", headers: sessionCookie ? { cookie: sessionCookie } : {} })).json<
      Record<string, unknown>
    >();
  assert.deepEqual((await me(cookie())).account_links, [{ label: "Admin", href: PAGE }]);
  const plain = await me(cookie(false));
  assert.deepEqual(Object.keys(plain), ["authenticated", "user", "expires_at", "login_available"]);
  assert.deepEqual(await me(), { authenticated: false, login_available: true });
  // Members without the claim never cause a Discord lookup.
  assert.deepEqual(lookups, [DISCORD_TEST_USER.id]);
  member.value = { ...ADMIN_MEMBER, roles: [] };
  assert.equal(Object.hasOwn(await me(cookie()), "account_links"), false);
});

test("the login marks the session of a member who holds an admin role, and only then", async () => {
  for (const [roles, claimed] of [
    [[DISCORD_TEST_ADMIN_ROLE, "902508392227176489"], true],
    [["902508392227176489"], false],
    [[], false],
  ] as const) {
    const { app, sessions } = await createAdminApp({ loginRoles: roles });
    const start = await app.inject("/api/auth/discord/start?returnTo=%2F");
    const state = new URL(String(start.headers.location)).searchParams.get("state") ?? "";
    const [stateCookie = ""] = setCookies(start.headers["set-cookie"]);
    assert.ok(stateCookie.startsWith(`${OAUTH_STATE_COOKIE}=`));
    const callback = await app.inject({
      url: `/api/auth/discord/callback?code=abc&state=${encodeURIComponent(state)}`,
      headers: { cookie: cookiePair(stateCookie) },
    });
    const session = setCookies(callback.headers["set-cookie"]).find((value) => value.startsWith("msc_session="));
    assert.equal(sessions.readSession(cookiePair(session ?? ""))?.adm === true, claimed, roles.join(","));
  }
});
