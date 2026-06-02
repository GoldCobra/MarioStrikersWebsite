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

function patchClubsService(overrides) {
  const modulePath = require.resolve("./services/clubs-service");
  const previous = require(modulePath);
  require.cache[modulePath].exports = Object.assign({}, previous, overrides);
  delete require.cache[require.resolve("./server")];
  return function restore() {
    require.cache[modulePath].exports = previous;
    delete require.cache[require.resolve("./server")];
  };
}

test("serves club profile payload from /api/clubs/msbl/:clubId/profile", async function () {
  const restore = patchClubsService({
    getMsblClubProfile: async function (clubId) {
      return {
        club: {
          club_id: Number(clubId),
          name: "Kickass FC",
          tag: "KFC",
          join_conditions: "Open to Anyone",
          region: "EU",
          club_code: "785XF50",
          regions: ["EU", "NA", "APAC"],
          club_codes: ["785XF50", "1G9MXHW", "7XM8WL2"],
          first_uniform: "Red",
          second_uniform: "Blue",
          stadium: "Lava Castle",
          discord_server: "https://discord.gg/msbl",
          created_at: "2026-01-01T00:00:00.000Z",
          logo: "/api/clubs/msbl/12/logo?v=abc",
          owner_name: "SaMuRaI7",
          owner_discord_id: "703837067322458112"
        },
        roster: [
          {
            player_id: 1,
            name: "SaMuRaI7",
            country: "ca",
            discord_id: "703837067322458112",
            discord_name: "samurai7",
            is_owner: true,
            is_officer: false,
            role: "owner"
          }
        ]
      };
    }
  });

  try {
    const { createApp } = require("./server");
    const server = await listen(createApp());

    try {
      const port = server.address().port;
      const response = await fetch("http://127.0.0.1:" + port + "/api/clubs/msbl/12/profile");
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.club.name, "Kickass FC");
      assert.equal(body.club.region, "EU");
      assert.equal(body.club.club_code, "785XF50");
      assert.deepEqual(body.club.regions, ["EU", "NA", "APAC"]);
      assert.deepEqual(body.club.club_codes, ["785XF50", "1G9MXHW", "7XM8WL2"]);
      assert.equal(body.club.first_uniform, "Red");
      assert.equal(body.club.second_uniform, "Blue");
      assert.equal(body.club.stadium, "Lava Castle");
      assert.equal(body.club.discord_server, "https://discord.gg/msbl");
      assert.equal(body.roster[0].discord_name, "samurai7");
      assert.equal(body.roster[0].role, "owner");
    } finally {
      server.close();
    }
  } finally {
    restore();
  }
});

test("returns 404 when club profile does not exist", async function () {
  const restore = patchClubsService({
    getMsblClubProfile: async function () {
      throw new Error("Club not found.");
    }
  });

  try {
    const { createApp } = require("./server");
    const server = await listen(createApp());

    try {
      const port = server.address().port;
      const response = await fetch("http://127.0.0.1:" + port + "/api/clubs/msbl/999999/profile");
      const body = await response.json();

      assert.equal(response.status, 404);
      assert.equal(body.error, "Club not found.");
    } finally {
      server.close();
    }
  } finally {
    restore();
  }
});
