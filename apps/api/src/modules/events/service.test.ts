import assert from "node:assert/strict";
import { test } from "node:test";
import { silentLogger } from "../../lib/logger.ts";
import {
  CommunityEventsCache,
  buildDiscordChannelUrl,
  detectEventGame,
  fetchCommunityEvents,
  filterCommunityEventChannels,
  formatEventDisplayName,
} from "./service.ts";

test("filters Discord event category channels and skips permanent channels", () => {
  const rows = filterCommunityEventChannels(
    [
      { id: "10", parent_id: "100", type: 0, name: "🥉・tournaments", position: 0 },
      { id: "11", parent_id: "100", type: 0, name: "🔹・sms-tech-showcase", position: 2 },
      { id: "12", parent_id: "100", type: 0, name: "🔸・msc-rebalanced-world-cup", position: 1 },
      { id: "13", parent_id: "100", type: 2, name: "Event Voice Channel", position: 3 },
      { id: "14", parent_id: "999", type: 0, name: "outside-category", position: 4 },
    ],
    { guildId: "268737069939949569", categoryId: "100" },
  );
  assert.deepEqual(
    rows.map((row) => row.name),
    ["msc-rebalanced-world-cup", "sms-tech-showcase"],
  );
  assert.deepEqual(
    rows.map((row) => row.display_name),
    ["MSC REBALANCED WORLD CUP", "SMS TECH SHOWCASE"],
  );
  assert.deepEqual(
    rows.map((row) => row.game),
    ["msc", "sms"],
  );
  assert.deepEqual(
    rows.map((row) => row.image_url),
    ["/assets/games/mscball.png", "/assets/games/smsball.png"],
  );
  assert.equal(rows[0]?.url, "https://discord.com/channels/268737069939949569/12");
});

test("formats event names and detects game marker icons", () => {
  assert.equal(formatEventDisplayName("🔺・bruiser-cup-2"), "BRUISER CUP 2");
  assert.equal(formatEventDisplayName("🔹・sms-tech-showcase"), "SMS TECH SHOWCASE");
  assert.equal(formatEventDisplayName("🔸・msc_rebalanced-world-cup"), "MSC REBALANCED WORLD CUP");
  assert.deepEqual(detectEventGame("🔹・sms-tech-showcase"), { game: "sms", image_url: "/assets/games/smsball.png" });
  assert.deepEqual(detectEventGame("🔸・msc-rebalanced-world-cup"), {
    game: "msc",
    image_url: "/assets/games/mscball.png",
  });
  assert.deepEqual(detectEventGame("🔺・bl-league-one"), { game: "msbl", image_url: "/assets/games/msblball.png" });
});

test("builds Discord channel URLs", () => {
  assert.equal(
    buildDiscordChannelUrl("268737069939949569", "123456789012345678"),
    "https://discord.com/channels/268737069939949569/123456789012345678",
  );
});

test("missing Discord events config returns an empty list without fetching", async () => {
  let fetched = false;
  const result = await fetchCommunityEvents({
    apiBase: "https://discord.test/api",
    botToken: "",
    guildId: "",
    categoryId: "",
    fetchTimeoutMs: 1000,
    fetchFn: () => {
      fetched = true;
      return Promise.resolve(new Response("[]"));
    },
  });
  assert.equal(fetched, false);
  assert.deepEqual(result, { count: 0, rows: [] });
});

test("community events cache keeps the last successful payload after refresh failures", async () => {
  let calls = 0;
  const cache = new CommunityEventsCache({
    refreshIntervalMs: 0,
    log: silentLogger,
    loader: () => {
      calls += 1;
      if (calls > 1) return Promise.reject(new Error("Discord unavailable"));
      return Promise.resolve({
        count: 1,
        rows: [
          {
            id: "11",
            name: "sms-tech-showcase",
            display_name: "SMS TECH SHOWCASE",
            game: "sms",
            image_url: "/assets/games/smsball.png",
            slug: "sms-tech-showcase",
            position: 1,
            url: "https://discord.com/channels/1/11",
          },
        ],
      });
    },
  });
  const first = await cache.refresh();
  const second = await cache.refresh();
  assert.equal(first.count, 1);
  assert.equal(second.count, 1);
  assert.equal(second.rows[0]?.name, "sms-tech-showcase");
});

test("a first refresh failure is reported", async () => {
  const cache = new CommunityEventsCache({
    refreshIntervalMs: 0,
    log: silentLogger,
    loader: () => Promise.reject(new Error("Discord unavailable")),
  });
  await assert.rejects(cache.get(), /Discord unavailable/);
});
