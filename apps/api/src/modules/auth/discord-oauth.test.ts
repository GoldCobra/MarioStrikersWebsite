import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../../config.ts";
import { DISCORD_TEST_ENV, DISCORD_TEST_USER, createFakeDiscordFetch } from "../../test-support/fake-discord.ts";
import { NotGuildMemberError, createDiscordOAuthClient } from "./discord-oauth.ts";

const discord = loadConfig(DISCORD_TEST_ENV).discord;

test("authorize URL asks for identify and guild membership with the signed state", () => {
  const url = new URL(createDiscordOAuthClient(discord).authorizeUrl("state-token"));
  assert.equal(url.origin + url.pathname, "https://discord.com/oauth2/authorize");
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.searchParams.get("redirect_uri"), DISCORD_TEST_ENV.DISCORD_REDIRECT_URI);
  assert.equal(url.searchParams.get("scope"), "identify guilds.members.read");
  assert.equal(url.searchParams.get("state"), "state-token");
});

test("completeLogin exchanges the code and returns server members", async () => {
  const fake = createFakeDiscordFetch();
  assert.deepEqual(await createDiscordOAuthClient(discord, fake.fetch).completeLogin("abc"), DISCORD_TEST_USER);
  assert.deepEqual(fake.requests.sort(), [
    "GET /api/users/@me",
    "GET /api/users/@me/guilds/987654321/member",
    "POST /api/oauth2/token",
  ]);
});

test("completeLogin rejects non-members and failed exchanges", async () => {
  await assert.rejects(
    createDiscordOAuthClient(discord, createFakeDiscordFetch({ member: false }).fetch).completeLogin("abc"),
    NotGuildMemberError,
  );
  const failing = (() => Promise.resolve(new Response("{}", { status: 401 }))) as typeof fetch;
  await assert.rejects(createDiscordOAuthClient(discord, failing).completeLogin("abc"), /token exchange failed/);
});
