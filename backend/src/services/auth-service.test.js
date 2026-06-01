const assert = require("node:assert/strict");
const test = require("node:test");

function withEnv(overrides, run) {
  const previous = {};
  Object.keys(overrides).forEach(function (key) {
    previous[key] = process.env[key];
    process.env[key] = overrides[key];
  });

  try {
    return run();
  } finally {
    Object.keys(overrides).forEach(function (key) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    });
  }
}

function loadAuthService() {
  delete require.cache[require.resolve("../config")];
  delete require.cache[require.resolve("./auth-service")];
  return require("./auth-service");
}

const AUTH_ENV = {
  DISCORD_CLIENT_ID: "client-id",
  DISCORD_CLIENT_SECRET: "client-secret",
  DISCORD_REDIRECT_URI: "http://localhost:8787/api/auth/discord/callback",
  DISCORD_GUILD_ID: "guild-id",
  SESSION_SECRET: "test-session-secret",
  SESSION_COOKIE_SECURE: "false"
};

test("OAuth state keeps a safe relative return path", function () {
  withEnv(AUTH_ENV, function () {
    const auth = loadAuthService();
    const state = auth.createOAuthState("/profile?tab=main");
    const verified = auth.verifyOAuthState(state);

    assert.equal(verified.returnTo, "/profile?tab=main");
  });
});

test("OAuth state rejects tampering", function () {
  withEnv(AUTH_ENV, function () {
    const auth = loadAuthService();
    const state = auth.createOAuthState("/profile");
    const tampered = state.slice(0, -1) + (state.endsWith("a") ? "b" : "a");

    assert.throws(function () {
      auth.verifyOAuthState(tampered);
    }, /Invalid OAuth state/);
  });
});

test("returnTo normalization rejects external and API targets", function () {
  withEnv(AUTH_ENV, function () {
    const auth = loadAuthService();

    assert.equal(auth.normalizeReturnTo("https://evil.example/profile"), "/profile");
    assert.equal(auth.normalizeReturnTo("//evil.example/profile"), "/profile");
    assert.equal(auth.normalizeReturnTo("/api/health"), "/profile");
    assert.equal(auth.normalizeReturnTo("/players#top"), "/players#top");
  });
});

test("session tokens reject tampering", function () {
  withEnv(AUTH_ENV, function () {
    const auth = loadAuthService();
    const token = auth.createSignedToken({
      discord_user_id: "123",
      expires_at: Date.now() + 60000
    }, "secret");
    const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");

    assert.equal(auth.verifySignedToken(token, "secret").discord_user_id, "123");
    assert.equal(auth.verifySignedToken(tampered, "secret"), null);
  });
});
