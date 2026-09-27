const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

function listen(app) {
  const server = http.createServer(app);
  return new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", function () {
      resolve(server);
    });
  });
}

function readRequestBody(req) {
  return new Promise(function (resolve) {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", function (chunk) {
      body += chunk;
    });
    req.on("end", function () {
      resolve(body);
    });
  });
}

async function createFakeDiscordServer(options) {
  const opts = options || {};
  const server = http.createServer(async function (req, res) {
    const url = new URL(req.url, "http://127.0.0.1");

    if (req.method === "POST" && url.pathname === "/oauth2/token") {
      const body = await readRequestBody(req);
      assert.match(body, /grant_type=authorization_code/);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ access_token: "discord-access-token", token_type: "Bearer" }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/users/@me") {
      assert.equal(req.headers.authorization, "Bearer discord-access-token");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        id: "709777875686916210",
        username: "goldcobra",
        global_name: "GoldCobra",
        avatar: "avatarhash"
      }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/users/@me/guilds/987654321/member") {
      assert.equal(req.headers.authorization, "Bearer discord-access-token");
      if (opts.member === false) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ message: "Unknown Member" }));
        return;
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ user: { id: "709777875686916210" }, roles: [] }));
      return;
    }

    res.statusCode = 404;
    res.end("not found");
  });

  await new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

function setAuthEnv(discordApiBase) {
  const values = {
    DISCORD_CLIENT_ID: "client-id",
    DISCORD_CLIENT_SECRET: "client-secret",
    DISCORD_REDIRECT_URI: "http://localhost:8787/api/auth/discord/callback",
    DISCORD_GUILD_ID: "987654321",
    DISCORD_API_BASE: discordApiBase || "https://discord.test/api",
    SESSION_SECRET: "route-test-session-secret",
    SESSION_COOKIE_SECURE: "false",
    SESSION_TTL_MS: "604800000",
    AUTH_STATE_TTL_MS: "600000"
  };

  const previous = {};
  Object.keys(values).forEach(function (key) {
    previous[key] = process.env[key];
    process.env[key] = values[key];
  });

  return function restoreEnv() {
    Object.keys(values).forEach(function (key) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    });
  };
}

function clearServerModules() {
  [
    "./config",
    "./services/auth-service",
    "./server"
  ].forEach(function (modulePath) {
    delete require.cache[require.resolve(modulePath)];
  });
}

function patchPlayersService(overrides) {
  const modulePath = require.resolve("./services/players-service");
  const previous = require(modulePath);
  require.cache[modulePath].exports = Object.assign({}, previous, overrides);
  delete require.cache[require.resolve("./server")];
  return function restore() {
    require.cache[modulePath].exports = previous;
    delete require.cache[require.resolve("./server")];
  };
}

test("Discord callback creates a signed session for server members", async function () {
  const fakeDiscord = await createFakeDiscordServer({ member: true });
  const fakeBase = "http://127.0.0.1:" + fakeDiscord.address().port;
  const restoreEnv = setAuthEnv(fakeBase);
  clearServerModules();

  try {
    const auth = require("./services/auth-service");
    const { createApp } = require("./server");
    const app = createApp();
    const server = await listen(app);

    try {
      const port = server.address().port;
      const state = auth.createOAuthState("/profile");
      const callbackUrl = "http://127.0.0.1:" + port + "/api/auth/discord/callback?code=abc&state=" + encodeURIComponent(state);
      const callbackResponse = await fetch(callbackUrl, { redirect: "manual" });
      const setCookie = callbackResponse.headers.get("set-cookie");

      assert.equal(callbackResponse.status, 302);
      assert.equal(callbackResponse.headers.get("location"), "/profile?auth=success");
      assert.match(setCookie, /msc_session=/);

      const meResponse = await fetch("http://127.0.0.1:" + port + "/api/auth/me", {
        headers: { Cookie: setCookie.split(";")[0] }
      });
      const me = await meResponse.json();

      assert.equal(me.authenticated, true);
      assert.equal(me.user.id, "709777875686916210");
      assert.equal(me.user.global_name, "GoldCobra");
    } finally {
      server.close();
    }
  } finally {
    fakeDiscord.close();
    restoreEnv();
    clearServerModules();
  }
});

test("Discord callback rejects non-members", async function () {
  const fakeDiscord = await createFakeDiscordServer({ member: false });
  const fakeBase = "http://127.0.0.1:" + fakeDiscord.address().port;
  const restoreEnv = setAuthEnv(fakeBase);
  clearServerModules();

  try {
    const auth = require("./services/auth-service");
    const { createApp } = require("./server");
    const server = await listen(createApp());

    try {
      const port = server.address().port;
      const state = auth.createOAuthState("/profile");
      const response = await fetch("http://127.0.0.1:" + port + "/api/auth/discord/callback?code=abc&state=" + encodeURIComponent(state), {
        redirect: "manual"
      });

      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), "/profile?auth=not_member");
      assert.equal(response.headers.get("set-cookie"), null);
    } finally {
      server.close();
    }
  } finally {
    fakeDiscord.close();
    restoreEnv();
    clearServerModules();
  }
});

test("invalid OAuth state is rejected", async function () {
  const restoreEnv = setAuthEnv();
  clearServerModules();

  try {
    const { createApp } = require("./server");
    const server = await listen(createApp());

    try {
      const port = server.address().port;
      const response = await fetch("http://127.0.0.1:" + port + "/api/auth/discord/callback?code=abc&state=bad");

      assert.equal(response.status, 400);
      assert.match(await response.text(), /Invalid OAuth state/);
    } finally {
      server.close();
    }
  } finally {
    restoreEnv();
    clearServerModules();
  }
});

test("tampered session cookies are treated as logged out", async function () {
  const restoreEnv = setAuthEnv();
  clearServerModules();

  try {
    const auth = require("./services/auth-service");
    const { createApp } = require("./server");
    const server = await listen(createApp());

    try {
      const port = server.address().port;
      const cookie = auth.createSessionCookie({ id: "123", username: "tester" }).split(";")[0];
      const tamperedCookie = cookie.slice(0, -1) + (cookie.endsWith("a") ? "b" : "a");
      const response = await fetch("http://127.0.0.1:" + port + "/api/auth/me", {
        headers: { Cookie: tamperedCookie }
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.authenticated, false);
    } finally {
      server.close();
    }
  } finally {
    restoreEnv();
    clearServerModules();
  }
});

test("/api/profile/me returns a no-profile state for linked Discord accounts without a player", async function () {
  const restoreEnv = setAuthEnv();
  clearServerModules();
  const auth = require("./services/auth-service");
  const restorePlayers = patchPlayersService({
    getPlayerProfileByDiscordId: async function () {
      return null;
    }
  });

  try {
    const { createApp } = require("./server");
    const server = await listen(createApp());

    try {
      const port = server.address().port;
      const cookie = auth.createSessionCookie({ id: "123", username: "tester" }).split(";")[0];
      const response = await fetch("http://127.0.0.1:" + port + "/api/profile/me", {
        headers: { Cookie: cookie }
      });
      const body = await response.json();

      assert.equal(response.status, 404);
      assert.equal(body.code, "PLAYER_PROFILE_NOT_LINKED");
      assert.equal(body.account.id, "123");
    } finally {
      server.close();
    }
  } finally {
    restorePlayers();
    restoreEnv();
    clearServerModules();
  }
});

test("/api/profile/me returns profile data for the authenticated Discord account", async function () {
  const restoreEnv = setAuthEnv();
  clearServerModules();
  const auth = require("./services/auth-service");
  const restorePlayers = patchPlayersService({
    getPlayerProfileByDiscordId: async function (discordId) {
      assert.equal(discordId, "123");
      return {
        player: {
          id: 42,
          name: "GoldCobra",
          country: "us",
          club_id: 8,
          club_name: "Chaos Edge",
          club_tag: "CE"
        },
        friend_codes: {},
        accolades: [],
        ratings: {}
      };
    }
  });

  try {
    const { createApp } = require("./server");
    const server = await listen(createApp());

    try {
      const port = server.address().port;
      const cookie = auth.createSessionCookie({ id: "123", username: "tester" }).split(";")[0];
      const response = await fetch("http://127.0.0.1:" + port + "/api/profile/me", {
        headers: { Cookie: cookie }
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.account.id, "123");
      assert.equal(body.profile.player.name, "GoldCobra");
      assert.equal(body.profile.player.club_id, 8);
    } finally {
      server.close();
    }
  } finally {
    restorePlayers();
    restoreEnv();
    clearServerModules();
  }
});

test("/api/profile/me fails closed on duplicate Discord profile links", async function () {
  const restoreEnv = setAuthEnv();
  clearServerModules();
  const auth = require("./services/auth-service");
  const restorePlayers = patchPlayersService({
    getPlayerProfileByDiscordId: async function () {
      const error = new Error("Multiple player profiles match this Discord account.");
      error.code = "PLAYER_PROFILE_CONFLICT";
      throw error;
    }
  });

  try {
    const { createApp } = require("./server");
    const server = await listen(createApp());

    try {
      const port = server.address().port;
      const cookie = auth.createSessionCookie({ id: "123", username: "tester" }).split(";")[0];
      const response = await fetch("http://127.0.0.1:" + port + "/api/profile/me", {
        headers: { Cookie: cookie }
      });
      const body = await response.json();

      assert.equal(response.status, 409);
      assert.equal(body.code, "PLAYER_PROFILE_CONFLICT");
    } finally {
      server.close();
    }
  } finally {
    restorePlayers();
    restoreEnv();
    clearServerModules();
  }
});
