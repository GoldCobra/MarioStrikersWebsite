import assert from "node:assert/strict";
import test from "node:test";
import { cookiePair, tamper } from "../../test-support/app.ts";
import { OAUTH_STATE_COOKIE, SessionManager } from "./session.ts";
import { createSignedToken } from "./tokens.ts";

function createManager(clock = { now: 1_000_000 }): SessionManager {
  return new SessionManager({
    secret: "session-test-secret-with-enough-length",
    cookieName: "msc_session",
    cookieSecure: true,
    ttlMs: 60_000,
    authStateTtlMs: 10_000,
    now: () => clock.now,
  });
}

test("OAuth state keeps a safe return path and is bound to the browser's nonce cookie", () => {
  const manager = createManager();
  const { state, cookie } = manager.createOAuthState("/profile?tab=main");
  assert.match(
    cookie,
    new RegExp(`^${OAUTH_STATE_COOKIE}=[0-9a-f]{32}; Max-Age=10; Path=/api/auth; HttpOnly; Secure; SameSite=Lax$`),
  );
  assert.deepEqual(manager.verifyOAuthState(state, cookiePair(cookie)), { returnTo: "/profile?tab=main" });
  assert.deepEqual(manager.verifyOAuthState(state, `other=1; ${cookiePair(cookie)}`), {
    returnTo: "/profile?tab=main",
  });
  assert.equal(manager.createOAuthState("https://evil.example").state.length > 0, true);
});

test("OAuth state is rejected when tampered, expired, replayed in another browser or signed elsewhere", () => {
  const clock = { now: 1_000_000 };
  const manager = createManager(clock);
  const first = manager.createOAuthState("/profile");
  const second = manager.createOAuthState("/profile");
  assert.equal(manager.verifyOAuthState(tamper(first.state), cookiePair(first.cookie)), null);
  // Login CSRF: a state issued to one browser does not complete a login in another.
  assert.equal(manager.verifyOAuthState(first.state, undefined), null);
  assert.equal(manager.verifyOAuthState(first.state, cookiePair(second.cookie)), null);
  const forged = createSignedToken({ nonce: "0".repeat(32), return_to: "/profile" }, "attacker-secret");
  assert.equal(manager.verifyOAuthState(forged, `${OAUTH_STATE_COOKIE}=${"0".repeat(32)}`), null);
  clock.now += 10_001;
  assert.equal(manager.verifyOAuthState(first.state, cookiePair(first.cookie)), null);
});

test("session cookies round-trip and fail closed", () => {
  const clock = { now: 1_000_000 };
  const manager = createManager(clock);
  const cookie = manager.createSessionCookie({ id: "123", username: "tester", global_name: "Tester", avatar: null });
  const session = manager.readSession(cookiePair(cookie));
  assert.equal(session?.discord_user_id, "123");
  assert.deepEqual(SessionManager.toAuthMeResponse(session), {
    authenticated: true,
    user: { id: "123", username: "tester", global_name: "Tester", avatar: "" },
    expires_at: new Date(1_060_000).toISOString(),
  });
  assert.equal(session.guild_nick, "");
  assert.equal(manager.readSession(tamper(cookiePair(cookie))), null);
  assert.equal(manager.readSession("msc_session=%"), null);
  assert.match(
    manager.clearSessionCookie(),
    /^msc_session=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=\//,
  );
  clock.now += 60_001;
  assert.equal(manager.readSession(cookiePair(cookie)), null);
  assert.deepEqual(SessionManager.toAuthMeResponse(null), { authenticated: false });
});

test("the session keeps the server nickname of the login", () => {
  const manager = createManager();
  const cookie = manager.createSessionCookie({ id: "123", username: "tester" }, "  [CE] Tester  ");
  assert.equal(manager.readSession(cookiePair(cookie))?.guild_nick, "[CE] Tester");
});
