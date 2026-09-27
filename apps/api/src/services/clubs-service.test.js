const assert = require("node:assert/strict");
const test = require("node:test");
const {
  compareRosterRows,
  extractDiscordName,
  extractDiscordId,
  isActivityActive,
  normalizeCountryCode,
  toActivityIso,
  toRosterRole,
  toMsblClubDTO
} = require("./clubs-service");

const NOW = new Date("2026-05-29T12:00:00.000Z");

function createClubRow(activity) {
  return {
    club_id: 368,
    tag: "ACS",
    name: "AC sTrikers",
    join_conditions: "Invite Only",
    is_open: false,
    region: "EU",
    region2: "NA",
    region3: "APAC",
    club_code: "123ABC",
    club_code2: "456DEF",
    club_code3: "789GHI",
    logo: "https://example.com/logo.webp",
    activity: activity,
    member_count: 9
  };
}

test("Club.Activity NULL is exposed as inactive", function () {
  const row = toMsblClubDTO(createClubRow(null), { now: NOW });

  assert.equal(row.activity, null);
  assert.equal(row.is_active, false);
  assert.equal(row.member_count, 9);
  assert.equal(row.region, "EU");
  assert.deepEqual(row.regions, ["EU", "NA", "APAC"]);
  assert.equal(row.club_code, "");
  assert.deepEqual(row.club_codes, []);
});

test("open clubs expose visible club codes", function () {
  const source = createClubRow(null);
  source.is_open = true;
  const row = toMsblClubDTO(source, { now: NOW });

  assert.equal(row.club_code, "123ABC");
  assert.deepEqual(row.club_codes, ["123ABC", "456DEF", "789GHI"]);
});

test("Club.Activity within 90 days is active", function () {
  const activity = new Date("2026-04-01T12:00:00.000Z");
  const row = toMsblClubDTO(createClubRow(activity), { now: NOW });

  assert.equal(row.activity, "2026-04-01T12:00:00.000Z");
  assert.equal(row.is_active, true);
});

test("Club.Activity older than 90 days is inactive", function () {
  const activity = new Date("2026-01-01T12:00:00.000Z");
  const row = toMsblClubDTO(createClubRow(activity), { now: NOW });

  assert.equal(row.activity, "2026-01-01T12:00:00.000Z");
  assert.equal(row.is_active, false);
});

test("activity helpers normalize invalid values safely", function () {
  assert.equal(toActivityIso(""), null);
  assert.equal(toActivityIso("not a date"), null);
  assert.equal(isActivityActive("not a date", NOW, 90), false);
});

test("extractDiscordId supports raw IDs and mention formats", function () {
  assert.equal(extractDiscordId("709777875686916210"), "709777875686916210");
  assert.equal(extractDiscordId("<@709777875686916210>"), "709777875686916210");
  assert.equal(extractDiscordId("<@!709777875686916210>xshadow39"), "709777875686916210");
  assert.equal(extractDiscordId("not-a-discord-id"), "");
});

test("extractDiscordName reads the Discord username suffix from mention storage", function () {
  assert.equal(extractDiscordName("<@!709777875686916210>goldcobra111"), "goldcobra111");
  assert.equal(extractDiscordName("<@709777875686916210> GoldCobra"), "GoldCobra");
  assert.equal(extractDiscordName("709777875686916210"), "");
});

test("country flags normalize UK subdivision aliases", function () {
  assert.equal(normalizeCountryCode("GB-ENG"), "gb-eng");
  assert.equal(normalizeCountryCode("england"), "gb-eng");
  assert.equal(normalizeCountryCode("Scotland"), "gb-sct");
  assert.equal(normalizeCountryCode("Wales"), "gb-wls");
  assert.equal(normalizeCountryCode("NIR"), "gb-nir");
  assert.equal(normalizeCountryCode("UK"), "gb");
  assert.equal(normalizeCountryCode("US"), "us");
  assert.equal(normalizeCountryCode("not-a-flag"), "");
});

test("toRosterRole maps owner/officer/member correctly", function () {
  assert.equal(toRosterRole(true, true), "owner");
  assert.equal(toRosterRole(false, true), "officer");
  assert.equal(toRosterRole(false, false), "member");
});

test("compareRosterRows sorts owner first, then officers A-Z, then members A-Z", function () {
  const rows = [
    { name: "Zulu", is_owner: false, is_officer: false, player_id: 5 },
    { name: "Bravo", is_owner: false, is_officer: true, player_id: 4 },
    { name: "Alpha", is_owner: true, is_officer: false, player_id: 3 },
    { name: "Charlie", is_owner: false, is_officer: true, player_id: 2 },
    { name: "Able", is_owner: false, is_officer: false, player_id: 1 }
  ];

  rows.sort(compareRosterRows);

  assert.deepEqual(
    rows.map(function (row) { return row.name; }),
    ["Alpha", "Bravo", "Charlie", "Able", "Zulu"]
  );
});

async function withMockedClubProfileService(pool, run) {
  const servicePath = require.resolve("./clubs-service");
  const dbPath = require.resolve("../db");
  const discordUsersPath = require.resolve("./discord-users-service");
  const previousService = require.cache[servicePath];
  const previousDb = require.cache[dbPath];
  const previousDiscordUsers = require.cache[discordUsersPath];

  delete require.cache[servicePath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      withPool: async function (callback) {
        return callback(pool);
      }
    }
  };
  require.cache[discordUsersPath] = {
    id: discordUsersPath,
    filename: discordUsersPath,
    loaded: true,
    exports: {
      resolveDiscordNamesForRoster: async function () {}
    }
  };

  try {
    return await run(require(servicePath));
  } finally {
    delete require.cache[servicePath];
    if (previousService) {
      require.cache[servicePath] = previousService;
    }
    if (previousDb) {
      require.cache[dbPath] = previousDb;
    } else {
      delete require.cache[dbPath];
    }
    if (previousDiscordUsers) {
      require.cache[discordUsersPath] = previousDiscordUsers;
    } else {
      delete require.cache[discordUsersPath];
    }
  }
}

test("club profile does not synthesize stale owner rows outside ClubRoster", async function () {
  const pool = {
    request: function () {
      return {
        input: function () {
          return this;
        },
        query: async function (sql) {
          if (sql.includes("FROM Club c")) {
            return {
              recordset: [{
                club_id: 32,
                tag: "W8",
                name: "World 8",
                join_conditions: "Invite Only",
                is_open: false,
                region: "",
                region2: "",
                region3: "",
                club_code: "",
                club_code2: "",
                club_code3: "",
                color1: "Red",
                color2: "Blue",
                stadium: "Lava Castle",
                discord_server: "",
                logo: "",
                owner_raw: "84806729719615488",
                created_at: null
              }]
            };
          }
          if (sql.includes("FROM ClubRoster cr")) {
            return {
              recordset: [{
                player_id: 398,
                name: "DelphinusVyse",
                country: "",
                discord_id: "136351840534003713",
                is_officer: false
              }]
            };
          }
          throw new Error("Unexpected query: " + sql);
        }
      };
    }
  };

  await withMockedClubProfileService(pool, async function (service) {
    const profile = await service.getMsblClubProfile(32, {
      logoCache: {
        ensureClubLogo: async function () {
          return "";
        }
      }
    });

    assert.equal(profile.roster.length, 1);
    assert.equal(profile.roster[0].name, "DelphinusVyse");
    assert.equal(profile.roster[0].role, "member");
    assert.equal(profile.club.owner_name, "");
    assert.equal(profile.club.owner_discord_id, "");
    assert.equal(profile.club.first_uniform, "Red");
    assert.equal(profile.club.second_uniform, "Blue");
    assert.equal(profile.club.stadium, "Lava Castle");
  });
});

test("invite-only club profiles keep stored club codes hidden", async function () {
  const pool = {
    request: function () {
      return {
        input: function () {
          return this;
        },
        query: async function (sql) {
          if (sql.includes("FROM Club c")) {
            return {
              recordset: [{
                club_id: 12,
                tag: "KFC",
                name: "Kickass FC",
                join_conditions: "Invite Only",
                is_open: false,
                region: "EU",
                region2: "NA",
                region3: "",
                club_code: "A1B2C3D",
                club_code2: "B1C2D3E",
                club_code3: "",
                color1: "",
                color2: "",
                stadium: "",
                discord_server: "",
                logo: "",
                owner_raw: "703837067322458112",
                created_at: null
              }]
            };
          }
          if (sql.includes("FROM ClubRoster cr")) {
            return { recordset: [] };
          }
          throw new Error("Unexpected query: " + sql);
        }
      };
    }
  };

  await withMockedClubProfileService(pool, async function (service) {
    const profile = await service.getMsblClubProfile(12, {
      logoCache: {
        ensureClubLogo: async function () {
          return "";
        }
      }
    });

    assert.equal(profile.club.club_code, "");
    assert.deepEqual(profile.club.club_codes, []);
    assert.deepEqual(profile.club.regions, ["EU", "NA"]);
    assert.equal(profile.club.first_uniform, "");
    assert.equal(profile.club.second_uniform, "");
    assert.equal(profile.club.stadium, "");
  });
});
