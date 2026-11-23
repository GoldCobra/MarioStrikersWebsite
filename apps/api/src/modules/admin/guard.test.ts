import assert from "node:assert/strict";
import test from "node:test";
import { cookiePair, tamper } from "../../test-support/app.ts";
import type { GuildMemberSnapshot } from "../../integrations/discord/guild-members.ts";
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
const ADMIN_ID = "195905866527014912";

interface Harness {
  guard: AdminGuard;
  sessions: SessionManager;
  clock: { now: number };
  lookups: { id: string; fresh: boolean }[];
  /** The member's roles in the server's member list; null: not on the list. */
  listed: { roles: string[] | null };
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
  const listed: { roles: string[] | null } = { roles: [ADMIN_ROLE] };
  const member: { value: GuildMember | Error } = {
    value: { membership: "member", nick: "", username: "goldcobra", globalName: "GoldCobra", roles: [ADMIN_ROLE] },
  };
  const snapshot = (): GuildMemberSnapshot => ({
    takenAt: clock.now,
    members: new Map(
      listed.roles === null
        ? []
        : [
            [
              ADMIN_ID,
              {
                id: ADMIN_ID,
                username: "goldcobra",
                globalName: "GoldCobra",
                nick: "",
                roles: listed.roles,
                joinedAt: 0,
              },
            ],
          ],
    ),
  });
  const guard = new AdminGuard(
    {
      settings: { roleIds: [ADMIN_ROLE], pathToken: TOKEN },
      memberList: { get: () => Promise.resolve(snapshot()) },
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
  return { guard, sessions, clock, lookups, listed, member };
}

function adminCookie(sessions: SessionManager): string {
  return cookiePair(sessions.createSessionCookie({ id: ADMIN_ID, username: "goldcobra" }, ""));
}

const refusal = (check: AdminCheck): string => (check.ok ? "ok" : check.reason);

test("a member the member list shows with an admin role and Discord confirms is an admin", async () => {
  const { guard, sessions, clock, lookups } = harness();
  const check = await guard.check(adminCookie(sessions));
  assert.ok(check.ok);
  assert.deepEqual(check.admin, {
    discordUserId: ADMIN_ID,
    username: "goldcobra",
    globalName: "GoldCobra",
    loginAt: clock.now,
    checkedAt: clock.now,
  });
  assert.deepEqual(lookups, [{ id: ADMIN_ID, fresh: false }]);
  await guard.check(adminCookie(sessions), { fresh: true });
  assert.deepEqual(lookups.at(-1), { id: ADMIN_ID, fresh: true });
});

test("without a valid session or without an admin role in the member list nobody is asked and nobody is an admin", async () => {
  const { guard, sessions, listed, lookups } = harness();
  const forged = `msc_session=${createSignedToken(
    { discord_user_id: ADMIN_ID, issued_at: 1, expires_at: Number.MAX_SAFE_INTEGER },
    "attacker-secret",
  )}`;
  for (const [cookie, reason] of [
    [undefined, "no_session"],
    ["", "no_session"],
    ["msc_session=invalid", "no_session"],
    [tamper(adminCookie(sessions)), "no_session"],
    [forged, "no_session"],
  ] as const) {
    assert.equal(refusal(await guard.check(cookie)), reason, String(cookie));
  }
  listed.roles = [OTHER_ROLE];
  assert.equal(refusal(await guard.check(adminCookie(sessions))), "not_admin");
  listed.roles = null;
  assert.equal(refusal(await guard.check(adminCookie(sessions))), "not_admin");
  assert.deepEqual(lookups, []);
});

test("access lasts as long as the login, and a role given in Discord counts without logging in again", async () => {
  const { guard, sessions, clock, listed } = harness();
  listed.roles = [];
  const cookie = adminCookie(sessions);
  assert.equal(refusal(await guard.check(cookie)), "not_admin");
  // The role is given later; the member list shows it with its next read, the same session opens the page.
  listed.roles = [ADMIN_ROLE];
  assert.equal(refusal(await guard.check(cookie)), "ok");
  clock.now += 7 * 24 * HOUR;
  assert.equal(refusal(await guard.check(cookie)), "ok");
  // The login itself ends after its seven days.
  clock.now += 1;
  assert.equal(refusal(await guard.check(cookie)), "no_session");
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
  assert.equal(check.ok ? "" : check.discordUserId, ADMIN_ID);
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
    settings: { roleIds: [ADMIN_ROLE], pathToken: TOKEN },
    memberList: { get: () => Promise.resolve(null) },
    members: { getMember: () => Promise.resolve(UNKNOWN_MEMBER) },
    audit: createMemoryAdminAuditStore(),
  };
  assert.equal(createAdminGuard({ admin: null, login: { sessions }, now: Date.now }), null);
  assert.equal(createAdminGuard({ admin: access, login: null, now: Date.now }), null);
  assert.ok(createAdminGuard({ admin: access, login: { sessions }, now: Date.now }));
});
