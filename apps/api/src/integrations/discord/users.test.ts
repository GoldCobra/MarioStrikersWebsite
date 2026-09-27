import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeDiscordId } from "../../lib/discord-id.ts";
import { DiscordUserDirectory, toDiscordUsername, type DiscordUserLookupOptions } from "./users.ts";

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function directory(overrides: Partial<DiscordUserLookupOptions>): DiscordUserDirectory {
  return new DiscordUserDirectory({
    apiBase: "https://discord.test/api",
    botToken: "bot-token",
    guildId: "guild-id",
    cacheTtlMs: 1000,
    failureCacheTtlMs: 60000,
    fetchTimeoutMs: 5000,
    parallelism: 4,
    ...overrides,
  });
}

test("normalizeDiscordId supports raw IDs and mention storage", () => {
  assert.equal(normalizeDiscordId("195905866527014912"), "195905866527014912");
  assert.equal(normalizeDiscordId("<@195905866527014912>"), "195905866527014912");
  assert.equal(normalizeDiscordId("<@!195905866527014912>goldcobra111"), "195905866527014912");
  assert.equal(normalizeDiscordId("goldcobra111"), "");
});

test("toDiscordUsername prefers the unique Discord username", () => {
  assert.equal(
    toDiscordUsername({ nick: "GoldCobra", user: { username: "goldcobra111", global_name: "GoldCobra" } }),
    "goldcobra111",
  );
});

test("a username lookup uses the bot token", async () => {
  const seen: { url: string; authorization: string }[] = [];
  const users = directory({
    fetchFn: (url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen.push({ url: requestUrl(url), authorization: headers.Authorization ?? "" });
      return Promise.resolve(jsonResponse({ user: { id: "1", username: "goldcobra111" }, nick: "GoldCobra" }));
    },
  });
  assert.equal(await users.getUsername("195905866527014912"), "goldcobra111");
  assert.deepEqual(seen, [
    { url: "https://discord.test/api/users/195905866527014912", authorization: "Bot bot-token" },
  ]);
});

test("successful lookups are cached", async () => {
  let calls = 0;
  const users = directory({
    fetchFn: () => {
      calls += 1;
      return Promise.resolve(jsonResponse({ user: { username: "cacheduser" } }));
    },
  });
  assert.equal(await users.getUsername("123"), "cacheduser");
  assert.equal(await users.getUsername("123"), "cacheduser");
  assert.equal(calls, 1);
});

test("the cache is bounded", async () => {
  let calls = 0;
  const users = directory({
    maxEntries: 2,
    fetchFn: () => {
      calls += 1;
      return Promise.resolve(jsonResponse({ user: { username: "someone" } }));
    },
  });
  for (const id of ["1", "2", "3", "1"]) await users.getUsername(id);
  assert.equal(calls, 4, "the oldest entry was evicted");
});

test("roster names are filled in and existing names are kept", async () => {
  const rows = [
    { name: "GoldCobra", discord_id: "195905866527014912", discord_name: "" },
    { name: "NiNa K", discord_id: "212631855587917825", discord_name: "existingname" },
  ];
  const fetchedIds: string[] = [];
  await directory({
    cacheTtlMs: 0,
    fetchFn: (url) => {
      fetchedIds.push(requestUrl(url).split("/").pop() ?? "");
      return Promise.resolve(jsonResponse({ user: { username: "goldcobra111" } }));
    },
  }).resolveRosterNames(rows);
  assert.equal(rows[0]?.discord_name, "goldcobra111");
  assert.equal(rows[1]?.discord_name, "existingname");
  assert.deepEqual(fetchedIds, ["195905866527014912"]);
});

test("without a bot token nothing is fetched", async () => {
  const rows = [{ name: "GoldCobra", discord_id: "195905866527014912", discord_name: "" }];
  await directory({
    botToken: "",
    fetchFn: () => {
      throw new Error("fetch should not run");
    },
  }).resolveRosterNames(rows);
  assert.equal(rows[0]?.discord_name, "");
});
