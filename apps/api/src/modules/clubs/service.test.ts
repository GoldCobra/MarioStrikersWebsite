import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakeDatabase } from "../../test-support/fake-database.ts";
import { attachClubLogos, getMsblClubProfile, type LogoResolver } from "./service.ts";

const noNames = { resolveRosterNames: <T>(rows: T[]): Promise<T[]> => Promise.resolve(rows) };
const emptyLogos: LogoResolver = { ensureClubLogo: () => Promise.resolve("") };

function clubRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
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
    color1: "",
    color2: "",
    stadium: "",
    discord_server: "",
    logo: "",
    owner_raw: "",
    created_at: null,
    ...overrides,
  };
}

test("club profile does not synthesize stale owner rows outside ClubRoster", async () => {
  const database = createFakeDatabase((sql) => {
    if (sql.includes("FROM Club c")) {
      return {
        recordset: [clubRow({ color1: "Red", color2: "Blue", stadium: "Lava Castle", owner_raw: "84806729719615488" })],
      };
    }
    if (sql.includes("FROM ClubRoster cr")) {
      return {
        recordset: [
          { player_id: 398, name: "DelphinusVyse", country: "", discord_id: "136351840534003713", is_officer: false },
        ],
      };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  const profile = await getMsblClubProfile(database, { logoCache: emptyLogos, users: noNames }, 32);

  assert.equal(profile?.roster.length, 1);
  assert.equal(profile.roster[0]?.name, "DelphinusVyse");
  assert.equal(profile.roster[0].role, "member");
  assert.equal(profile.club.owner_name, "");
  assert.equal(profile.club.owner_discord_id, "");
  assert.equal(profile.club.first_uniform, "Red");
  assert.equal(profile.club.second_uniform, "Blue");
  assert.equal(profile.club.stadium, "Lava Castle");
});

test("invite-only club profiles keep stored club codes hidden", async () => {
  const database = createFakeDatabase((sql) =>
    sql.includes("FROM Club c")
      ? {
          recordset: [
            clubRow({
              club_id: 12,
              tag: "KFC",
              name: "Kickass FC",
              region: "EU",
              region2: "NA",
              club_code: "A1B2C3D",
              club_code2: "B1C2D3E",
              owner_raw: "703837067322458112",
            }),
          ],
        }
      : { recordset: [] },
  );

  const profile = await getMsblClubProfile(database, { logoCache: emptyLogos, users: noNames }, 12);

  assert.equal(profile?.club.club_code, "");
  assert.deepEqual(profile.club.club_codes, []);
  assert.deepEqual(profile.club.regions, ["EU", "NA"]);
  assert.equal(profile.club.first_uniform, "");
});

test("the owner is the roster member whose Discord id matches Club.Owner", async () => {
  const database = createFakeDatabase((sql) =>
    sql.includes("FROM Club c")
      ? { recordset: [clubRow({ owner_raw: "<@111111111111111111>" })] }
      : {
          recordset: [
            { player_id: 1, name: "Member", discord_id: "222222222222222222", is_officer: 0 },
            { player_id: 2, name: "Owner", discord_id: "<@111111111111111111>owner_name", is_officer: 1 },
          ],
        },
  );
  const profile = await getMsblClubProfile(database, { logoCache: emptyLogos, users: noNames }, 32);
  assert.equal(profile?.club.owner_name, "Owner");
  assert.equal(profile.club.owner_discord_id, "111111111111111111");
  assert.deepEqual(
    profile.roster.map((row) => [row.name, row.role, row.discord_name]),
    [
      ["Owner", "owner", "owner_name"],
      ["Member", "member", ""],
    ],
  );
});

test("a missing club is null", async () => {
  const database = createFakeDatabase(() => ({ recordset: [] }));
  assert.equal(await getMsblClubProfile(database, { logoCache: emptyLogos, users: noNames }, 999), null);
});

test("attachClubLogos leaves empty SQL logos empty and removes internal source values", async () => {
  const rows = [
    { club_id: 1, logo_source: "", logo: "" },
    { club_id: 2, logo_source: "https://example.com/logo.png", logo: "" },
  ] as unknown as Parameters<typeof attachClubLogos>[0];
  const result = await attachClubLogos(rows, { ensureClubLogo: () => Promise.resolve("/api/clubs/msbl/2/logo?v=abc") });
  assert.equal(result[0]?.logo, "");
  assert.equal(result[1]?.logo, "/api/clubs/msbl/2/logo?v=abc");
  assert.deepEqual(
    result.map((row) => Object.hasOwn(row, "logo_source")),
    [false, false],
  );
});
