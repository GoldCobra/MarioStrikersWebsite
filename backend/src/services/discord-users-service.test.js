const assert = require("node:assert/strict");
const test = require("node:test");
const {
  clearDiscordUserCache,
  getDiscordUsernameById,
  normalizeDiscordId,
  resolveDiscordNamesForRoster,
  toDiscordUsername
} = require("./discord-users-service");

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}

test("normalizeDiscordId supports raw IDs and mention storage", function () {
  assert.equal(normalizeDiscordId("195905866527014912"), "195905866527014912");
  assert.equal(normalizeDiscordId("<@195905866527014912>"), "195905866527014912");
  assert.equal(normalizeDiscordId("<@!195905866527014912>goldcobra111"), "195905866527014912");
  assert.equal(normalizeDiscordId("goldcobra111"), "");
});

test("toDiscordUsername prefers the unique Discord username", function () {
  assert.equal(toDiscordUsername({
    nick: "GoldCobra",
    user: {
      username: "goldcobra111",
      global_name: "GoldCobra"
    }
  }), "goldcobra111");
});

test("getDiscordUsernameById fetches a guild member with bot auth", async function () {
  clearDiscordUserCache();
  const seen = [];
  const username = await getDiscordUsernameById("195905866527014912", {
    apiBase: "https://discord.test/api",
    botToken: "bot-token",
    guildId: "guild-id",
    cacheTtlMs: 1000,
    fetchFn: async function (url, init) {
      seen.push({ url, init });
      return jsonResponse({
        user: {
          id: "195905866527014912",
          username: "goldcobra111",
          global_name: "GoldCobra"
        },
        nick: "GoldCobra"
      });
    }
  });

  assert.equal(username, "goldcobra111");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://discord.test/api/guilds/guild-id/members/195905866527014912");
  assert.equal(seen[0].init.headers.Authorization, "Bot bot-token");
});

test("getDiscordUsernameById caches successful member lookups", async function () {
  clearDiscordUserCache();
  let calls = 0;
  const opts = {
    apiBase: "https://discord.test/api",
    botToken: "bot-token",
    guildId: "guild-id",
    cacheTtlMs: 1000,
    fetchFn: async function () {
      calls += 1;
      return jsonResponse({ user: { username: "cacheduser" } });
    }
  };

  assert.equal(await getDiscordUsernameById("123", opts), "cacheduser");
  assert.equal(await getDiscordUsernameById("123", opts), "cacheduser");
  assert.equal(calls, 1);
});

test("resolveDiscordNamesForRoster fills missing names and preserves existing names", async function () {
  clearDiscordUserCache();
  const rows = [
    { name: "GoldCobra", discord_id: "195905866527014912", discord_name: "" },
    { name: "NiNa K", discord_id: "212631855587917825", discord_name: "existingname" }
  ];
  const fetchedIds = [];

  await resolveDiscordNamesForRoster(rows, {
    apiBase: "https://discord.test/api",
    botToken: "bot-token",
    guildId: "guild-id",
    cacheTtlMs: 0,
    fetchFn: async function (url) {
      fetchedIds.push(url.split("/").pop());
      return jsonResponse({ user: { username: "goldcobra111" } });
    }
  });

  assert.equal(rows[0].discord_name, "goldcobra111");
  assert.equal(rows[1].discord_name, "existingname");
  assert.deepEqual(fetchedIds, ["195905866527014912"]);
});

test("resolveDiscordNamesForRoster is a no-op without bot config", async function () {
  clearDiscordUserCache();
  const rows = [{ name: "GoldCobra", discord_id: "195905866527014912", discord_name: "" }];
  await resolveDiscordNamesForRoster(rows, {
    botToken: "",
    guildId: "guild-id",
    fetchFn: async function () {
      throw new Error("fetch should not run");
    }
  });

  assert.equal(rows[0].discord_name, "");
});
