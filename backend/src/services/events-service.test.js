const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CommunityEventsCache,
  buildDiscordChannelUrl,
  detectEventGame,
  fetchCommunityEvents,
  filterCommunityEventChannels,
  formatEventDisplayName
} = require("./events-service");

test("filters Discord event category channels and skips permanent channels", function () {
  const rows = filterCommunityEventChannels([
    { id: "10", parent_id: "100", type: 0, name: "🥉・tournaments", position: 0 },
    { id: "11", parent_id: "100", type: 0, name: "🔹・sms-tech-showcase", position: 2 },
    { id: "12", parent_id: "100", type: 0, name: "🔸・msc-rebalanced-world-cup", position: 1 },
    { id: "13", parent_id: "100", type: 2, name: "Event Voice Channel", position: 3 },
    { id: "14", parent_id: "999", type: 0, name: "outside-category", position: 4 }
  ], {
    guildId: "268737069939949569",
    categoryId: "100"
  });

  assert.deepEqual(rows.map(function (row) { return row.name; }), [
    "msc-rebalanced-world-cup",
    "sms-tech-showcase"
  ]);
  assert.deepEqual(rows.map(function (row) { return row.display_name; }), [
    "MSC REBALANCED WORLD CUP",
    "SMS TECH SHOWCASE"
  ]);
  assert.deepEqual(rows.map(function (row) { return row.game; }), ["msc", "sms"]);
  assert.deepEqual(rows.map(function (row) { return row.image_url; }), [
    "/assets/games/mscball.png",
    "/assets/games/smsball.png"
  ]);
  assert.equal(rows[0].url, "https://discord.com/channels/268737069939949569/12");
});

test("formats event names and detects game marker icons", function () {
  assert.equal(formatEventDisplayName("🔺・bruiser-cup-2"), "BRUISER CUP 2");
  assert.equal(formatEventDisplayName("🔹・sms-tech-showcase"), "SMS TECH SHOWCASE");
  assert.equal(formatEventDisplayName("🔸・msc_rebalanced-world-cup"), "MSC REBALANCED WORLD CUP");

  assert.deepEqual(detectEventGame("🔹・sms-tech-showcase"), {
    game: "sms",
    image_url: "/assets/games/smsball.png"
  });
  assert.deepEqual(detectEventGame("🔸・msc-rebalanced-world-cup"), {
    game: "msc",
    image_url: "/assets/games/mscball.png"
  });
  assert.deepEqual(detectEventGame("🔺・bl-league-one"), {
    game: "msbl",
    image_url: "/assets/games/msblball.png"
  });
});

test("builds Discord channel URLs", function () {
  assert.equal(
    buildDiscordChannelUrl("268737069939949569", "123456789012345678"),
    "https://discord.com/channels/268737069939949569/123456789012345678"
  );
});

test("missing Discord events config returns an empty list without fetching", async function () {
  let fetched = false;
  const result = await fetchCommunityEvents({
    botToken: "",
    guildId: "",
    categoryId: "",
    fetchFn: async function () {
      fetched = true;
      return { ok: true, json: async function () { return []; } };
    }
  });

  assert.equal(fetched, false);
  assert.deepEqual(result, { count: 0, rows: [] });
});

test("community events cache keeps the last successful payload after refresh failures", async function () {
  let calls = 0;
  const cache = new CommunityEventsCache({
    refreshIntervalMs: 0,
    logger: { warn: function () {} },
    loader: async function () {
      calls += 1;
      if (calls > 1) {
        throw new Error("Discord unavailable");
      }
      return {
        count: 1,
        rows: [{
          id: "11",
          name: "sms-tech-showcase",
          display_name: "SMS TECH SHOWCASE",
          game: "sms",
          image_url: "/assets/games/smsball.png",
          slug: "sms-tech-showcase",
          position: 1,
          url: "https://discord.com/channels/1/11"
        }]
      };
    }
  });

  const first = await cache.refresh();
  const second = await cache.refresh();

  assert.equal(first.count, 1);
  assert.equal(second.count, 1);
  assert.equal(second.rows[0].name, "sms-tech-showcase");
});
