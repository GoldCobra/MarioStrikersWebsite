import assert from "node:assert/strict";
import test from "node:test";
import { DiscordMemberDirectory, UNKNOWN_MEMBER, toGuildMember } from "./members.ts";

const GUILD = "268737069939949569";
const MEMBER = "195905866527014912";

function directory(respond: (path: string) => Response | Promise<Response>, botToken = "bot-token") {
  const requests: string[] = [];
  const fetchFn = ((input: string | URL | Request) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname;
    requests.push(path);
    return Promise.resolve(respond(path));
  }) as typeof fetch;
  const members = new DiscordMemberDirectory({
    apiBase: "https://discord.test/api",
    botToken,
    fetchTimeoutMs: 1000,
    fetchFn,
    guildId: GUILD,
    cacheTtlMs: 60_000,
    failureCacheTtlMs: 60_000,
  });
  return { members, requests };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("members are read with their nickname, username and global name", async () => {
  const { members, requests } = directory(() =>
    json({ nick: "[CE] GoldCobra", user: { id: MEMBER, username: "goldcobra", global_name: "GoldCobra" } }),
  );
  assert.deepEqual(await members.getMember(MEMBER), {
    membership: "member",
    nick: "[CE] GoldCobra",
    username: "goldcobra",
    globalName: "GoldCobra",
    roles: [],
  });
  // A second lookup within the cache time asks Discord nothing.
  await members.getMember(MEMBER);
  assert.deepEqual(requests, [`/api/guilds/${GUILD}/members/${MEMBER}`]);
});

test("members are read with their role ids; a fresh lookup skips the cache", async () => {
  let roles: unknown = ["1070908166725967942", "902508392227176489"];
  const { members, requests } = directory(() => json({ roles, user: { id: MEMBER, username: "goldcobra" } }));
  assert.deepEqual((await members.getMember(MEMBER)).roles, ["1070908166725967942", "902508392227176489"]);
  roles = [];
  assert.deepEqual((await members.getMember(MEMBER)).roles, ["1070908166725967942", "902508392227176489"]);
  assert.deepEqual((await members.getMember(MEMBER, { fresh: true })).roles, []);
  // The fresh answer replaces the cached one.
  assert.deepEqual((await members.getMember(MEMBER)).roles, []);
  assert.equal(requests.length, 2);
});

test("members without a nickname or global name have empty ones; malformed roles are dropped", () => {
  assert.deepEqual(toGuildMember(true, 200, { nick: null, user: { username: "tester", global_name: null } }), {
    membership: "member",
    nick: "",
    username: "tester",
    globalName: "",
    roles: [],
  });
  assert.deepEqual(toGuildMember(true, 200, { roles: ["123", 456, "<@&789>", null, "  1 "] }).roles, ["123"]);
  assert.deepEqual(toGuildMember(true, 200, { roles: "123" }).roles, []);
});

test("404 means the account is not on the server; other failures are unknown", async () => {
  assert.equal((await directory(() => json({ code: 10007 }, 404)).members.getMember(MEMBER)).membership, "not_member");
  assert.deepEqual(
    await directory(() => json({ message: "Server error" }, 500)).members.getMember(MEMBER),
    UNKNOWN_MEMBER,
  );
  assert.deepEqual(toGuildMember(false, 0, null), UNKNOWN_MEMBER);
});

test("without a bot token or with an invalid id nothing is asked", async () => {
  const withoutToken = directory(() => json({}), "");
  assert.deepEqual(await withoutToken.members.getMember(MEMBER), UNKNOWN_MEMBER);
  assert.deepEqual(withoutToken.requests, []);
  const invalid = directory(() => json({}));
  assert.deepEqual(await invalid.members.getMember("<@123>"), UNKNOWN_MEMBER);
  assert.deepEqual(invalid.requests, []);
});
