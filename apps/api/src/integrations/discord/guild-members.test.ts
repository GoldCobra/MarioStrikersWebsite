import assert from "node:assert/strict";
import test from "node:test";
import { GuildMemberList, toSnapshotMember } from "./guild-members.ts";

const GUILD = "268737069939949569";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Members with ids 1..count, served in pages of up to 1,000 after the given id, like Discord. */
function memberList(count: () => number, failing: () => boolean = () => false) {
  const requests: string[] = [];
  const clock = { now: 1_800_000_000_000 };
  const fetchFn = ((input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    requests.push(url.pathname + url.search);
    if (failing()) return Promise.resolve(json({ message: "Server error" }, 500));
    const after = Number(url.searchParams.get("after"));
    const limit = Number(url.searchParams.get("limit"));
    const page = [];
    for (let id = after + 1; id <= count() && page.length < limit; id += 1) {
      page.push({ user: { id: String(id), username: `user${id}` }, joined_at: "2026-01-01T00:00:00.000Z", roles: [] });
    }
    return Promise.resolve(json(page));
  }) as typeof fetch;
  const list = new GuildMemberList({
    apiBase: "https://discord.test/api",
    botToken: "bot-token",
    fetchTimeoutMs: 1000,
    fetchFn,
    guildId: GUILD,
    maxAgeMs: 10 * 60_000,
    now: () => clock.now,
  });
  return { list, requests, clock };
}

test("the member list is read page by page and kept until it is old", async () => {
  const { list, requests, clock } = memberList(() => 2500);
  const first = await list.get();
  assert.equal(first?.members.size, 2500);
  assert.deepEqual(requests, [
    `/api/guilds/${GUILD}/members?limit=1000&after=0`,
    `/api/guilds/${GUILD}/members?limit=1000&after=1000`,
    `/api/guilds/${GUILD}/members?limit=1000&after=2000`,
  ]);
  assert.deepEqual(first.members.get("7"), {
    id: "7",
    username: "user7",
    globalName: "",
    nick: "",
    roles: [],
    joinedAt: Date.parse("2026-01-01T00:00:00.000Z"),
  });
  clock.now += 5 * 60_000;
  assert.equal(await list.get(), first, "a young list is not read again");
  clock.now += 6 * 60_000;
  const second = await list.get();
  assert.notEqual(second, first);
  assert.equal(requests.length, 6);
});

test("a failed or much shorter read keeps the last complete list", async () => {
  let count = 3000;
  let failing = false;
  const { list, clock } = memberList(
    () => count,
    () => failing,
  );
  const first = await list.get();
  assert.equal(first?.members.size, 3000);

  clock.now += 11 * 60_000;
  failing = true;
  assert.equal(await list.get(), first, "Discord failed: the last list stays");

  clock.now += 2 * 60_000;
  failing = false;
  count = 1200;
  assert.equal(await list.get(), first, "60 % fewer members in minutes: not trusted");

  clock.now += 2 * 60_000;
  count = 2950;
  const shorter = await list.get();
  assert.equal(shorter?.members.size, 2950, "a few members left: the new list counts");
});

test("parallel callers share one read, and nothing is read without a token", async () => {
  const { list, requests } = memberList(() => 10);
  const [a, b] = await Promise.all([list.get(), list.get()]);
  assert.equal(a, b);
  assert.equal(requests.length, 1);

  const silent = new GuildMemberList({
    apiBase: "https://discord.test/api",
    botToken: "",
    fetchTimeoutMs: 1000,
    guildId: GUILD,
    maxAgeMs: 60_000,
  });
  assert.equal(await silent.get(), null);
});

test("entries without a user id are dropped; names, roles and the join date are read", () => {
  assert.equal(toSnapshotMember({ user: {} }), null);
  assert.equal(toSnapshotMember(null), null);
  assert.deepEqual(
    toSnapshotMember({
      nick: "[CE] GoldCobra",
      roles: ["271232737917140992", 5],
      joined_at: "2020-05-01T10:00:00.000+00:00",
      user: { id: "195905866527014912", username: "goldcobra", global_name: "GoldCobra" },
    }),
    {
      id: "195905866527014912",
      username: "goldcobra",
      globalName: "GoldCobra",
      nick: "[CE] GoldCobra",
      roles: ["271232737917140992"],
      joinedAt: Date.parse("2020-05-01T10:00:00.000Z"),
    },
  );
  assert.equal(toSnapshotMember({ user: { id: "1" }, joined_at: "not a date" })?.joinedAt, null);
});
