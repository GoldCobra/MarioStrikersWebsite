import assert from "node:assert/strict";
import test from "node:test";
import { cookiePair, tamper } from "../../test-support/app.ts";
import { UNKNOWN_MEMBER, type GuildMember } from "../../integrations/discord/members.ts";
import { SessionManager } from "../auth/session.ts";
import { createSignedToken } from "../auth/tokens.ts";
import { createMemoryAdminAuditStore } from "./audit.ts";
import { AdminGuard, createAdminGuard, hasAdminRole, type AdminCheck } from "./guard.ts";

const SECRET = "guard-test-session-secret-with-length";
const ADMIN_ROLE = "1070908166725967942";
const OTHER_ROLE = "902508392227176489";
const TOKEN = "Zx9-kq_3VtLm0aB7cD1eF2";
const HOUR = 60 * 60 * 1000;

interface Harness {
  guard: AdminGuard;
  sessions: SessionManager;
  clock: { now: number };
  lookups: { id: string; fresh: boolean }[];
  member: { value: GuildMember | Error };
}

function harness(): Harness {
  const clock = { now: 1_800_000_000_000 };
  const sessions = new SessionManager({
    secret: SECRET,
    cookieName: "msc_session",
    cookieSecure: true,
    ttlMs: 7 * 24 * HOUR,
    authStateTtlMs: 600_000,
    now: () => clock.now,
  });
  const lookups: { id: string; fresh: boolean }[] = [];
  const member: { value: GuildMember | Error } = {
    value: { membership: "member", nick: "", username: "goldcobra", globalName: "GoldCobra", roles: [ADMIN_ROLE] },
  };
  const guard = new AdminGuard(
    {
      settings: { roleIds: [ADMIN_ROLE], pathToken: TOKEN, sessionMaxAgeMs: 12 * HOUR },
      members: {
        getMember: (id, options) => {
          lookups.push({ id, fresh: options?.fresh ?? false });
          return member.value instanceof Error ? Promise.reject(member.value) : Promise.resolve(member.value);
        },
      },
      audit: createMemoryAdminAuditStore(),
    },
    sessions,
    () => clock.now,
  );
  return { guard, sessions, clock, lookups, member };
}

function adminCookie(sessions: SessionManager, adminCandidate = true): string {
  return cookiePair(
    sessions.createSessionCookie({ id: "195905866527014912", username: "goldcobra" }, "", { adminCandidate }),
  );
}

const refusal = (check: AdminCheck): string => (check.ok ? "ok" : check.reason);

test("a session with the login's claim and a confirmed admin role is an admin", async () => {
  const { guard, sessions, clock, lookups } = harness();
  const check = await guard.check(adminCookie(sessions));
  assert.ok(check.ok);
  assert.deepEqual(check.admin, {
    discordUserId: "195905866527014912",
    username: "goldcobra",
    globalName: "GoldCobra",
    accessUntil: clock.now + 12 * HOUR,
    checkedAt: clock.now,
  });
  assert.deepEqual(lookups, [{ id: "195905866527014912", fresh: false }]);
  await guard.check(adminCookie(sessions), { fresh: true });
  assert.deepEqual(lookups.at(-1), { id: "195905866527014912", fresh: true });
});

test("without a valid session or without the claim nobody is asked and nobody is an admin", async () => {
  const { guard, sessions, lookups } = harness();
  const forged = `msc_session=${createSignedToken(
    { discord_user_id: "195905866527014912", adm: true, issued_at: 1, expires_at: Number.MAX_SAFE_INTEGER },
    "attacker-secret",
  )}`;
  for (const [cookie, reason] of [
    [undefined, "no_session"],
    ["", "no_session"],
    ["msc_session=invalid", "no_session"],
    [tamper(adminCookie(sessions)), "no_session"],
    [forged, "no_session"],
    [adminCookie(sessions, false), "no_claim"],
  ] as const) {
    assert.equal(refusal(await guard.check(cookie)), reason, String(cookie));
  }
  assert.deepEqual(lookups, []);
});

test("a session older than the admin limit, expired or from the future is refused before Discord is asked", async () => {
  const { guard, sessions, clock, lookups } = harness();
  const cookie = adminCookie(sessions);
  clock.now += 12 * HOUR - 1;
  assert.equal(refusal(await guard.check(cookie)), "ok");
  clock.now += 1;
  assert.equal(refusal(await guard.check(cookie)), "session_too_old");
  const future = cookiePair(sessions.createSessionCookie({ id: "1" }, "", { adminCandidate: true }));
  clock.now -= 2 * 60_000;
  assert.equal(refusal(await guard.check(future)), "session_too_old");
  assert.equal(lookups.length, 1);
});

test("a removed role, a member who left and an unreachable Discord all mean no admin", async () => {
  const { guard, sessions, member } = harness();
  const cookie = adminCookie(sessions);
  member.value = { membership: "member", nick: "", username: "x", globalName: "", roles: [OTHER_ROLE] };
  assert.equal(refusal(await guard.check(cookie)), "no_role");
  member.value = { ...UNKNOWN_MEMBER, membership: "not_member" };
  assert.equal(refusal(await guard.check(cookie)), "not_member");
  member.value = UNKNOWN_MEMBER;
  assert.equal(refusal(await guard.check(cookie)), "discord_unavailable");
  member.value = new Error("timeout");
  assert.equal(refusal(await guard.check(cookie)), "discord_unavailable");
  const check = await guard.check(cookie);
  assert.equal(check.ok ? "" : check.discordUserId, "195905866527014912");
});

test("only the exact path token opens the page path", () => {
  const { guard } = harness();
  assert.equal(guard.pagePath, `/_/${TOKEN}/`);
  for (const uri of [`/_/${TOKEN}/`, `/_/${TOKEN}/index.html`, `/_/${TOKEN}/assets/admin.js?x=1`]) {
    assert.equal(guard.isPagePath(uri), true, uri);
  }
  for (const uri of [
    "",
    "/admin",
    "/_/",
    `/_/${TOKEN}`,
    `/_/${TOKEN.slice(0, -1)}/`,
    `/_/${TOKEN}x/`,
    `/_/${TOKEN.toLowerCase()}/`,
    `/x/${TOKEN}/`,
    `//_/${TOKEN}/`,
  ]) {
    assert.equal(guard.isPagePath(uri), false, uri);
  }
});

test("role ids match exactly; no admin page without the admin settings or the login", () => {
  assert.equal(hasAdminRole([OTHER_ROLE, ADMIN_ROLE], [ADMIN_ROLE]), true);
  assert.equal(hasAdminRole([OTHER_ROLE], [ADMIN_ROLE]), false);
  assert.equal(hasAdminRole([], [ADMIN_ROLE]), false);
  assert.equal(hasAdminRole([ADMIN_ROLE], []), false);
  const { sessions } = harness();
  const access = {
    settings: { roleIds: [ADMIN_ROLE], pathToken: TOKEN, sessionMaxAgeMs: HOUR },
    members: { getMember: () => Promise.resolve(UNKNOWN_MEMBER) },
    audit: createMemoryAdminAuditStore(),
  };
  assert.equal(createAdminGuard({ admin: null, login: { sessions }, now: Date.now }), null);
  assert.equal(createAdminGuard({ admin: access, login: null, now: Date.now }), null);
  assert.ok(createAdminGuard({ admin: access, login: { sessions }, now: Date.now }));
});
