// The profile editor's store (ProfileStore of service.ts): SQL of the signed-in player's own profile. A new profile
// is created in one batch that first locks the Discord id's key range (UPDLOCK, HOLDLOCK), so parallel logins wait
// for each other and reuse the row the first one created; the unique index IX_Player_DiscordID stays the last guard
// against a second row. A save reads the profile under update locks, decides and writes in one transaction. Like the
// bot's procedures, every creation and every save is written to dbo.CommandLog. The selected title, the player's
// unlocked titles and their temporary test unlocks are read with the profile; the title catalog comes from its cache.

import { normalizeText } from "@ms/shared/text";
import type { Database, Queries, Row } from "../../db/database.ts";
import { sql, t, type Statement } from "../../db/sql.ts";
import { isUniqueViolation } from "../../lib/sql-errors.ts";
import { availableTitles, selectedTitle, toTitleOption, type CatalogTitle } from "../titles/availability.ts";
import type { TitleCatalog } from "../titles/repository.ts";
import type {
  ChangePlan,
  CodeKey,
  CountryOption,
  EnsuredPlayer,
  ProfileStore,
  StoredFriendCode,
  StoredProfile,
} from "./service.ts";

/** dbo.Enumeration rarely changes; the countries are read once an hour. */
const COUNTRIES_TTL_MS = 60 * 60 * 1000;

/** The creation batch's answer: the Discord id's player and whether this batch created it. */
interface EnsuredPlayerRecord {
  player_id: number | null;
  created: boolean;
}

interface PlayerIdRecord {
  player_id: number;
}

interface CountryRecord {
  Code: string;
  Description: string | null;
}

// The profile batch's rows extend Row: its result sets arrive as Row[][] and are read as ProfileSets.

interface PlayerRecord extends Row {
  country: string | null;
}

interface FriendCodeRecord extends Row {
  GameType: number;
  Region: string;
  LineSeq: number;
  Label: string;
  Code: string;
}

interface TitleIdRecord extends Row {
  TitleId: number;
}

interface TakenCodeRecord extends Row {
  GameType: number;
  Code: string;
}

/** The profile batch's result sets in its order; the taken codes only when a save asks for some. */
type ProfileSets = [
  players: PlayerRecord[],
  codes: FriendCodeRecord[],
  activeTitles: TitleIdRecord[],
  unlocks: TitleIdRecord[],
  testUnlocks: TitleIdRecord[],
  taken?: TakenCodeRecord[],
];

/** The Discord id's player; one with this name is created (and logged) when there is none. */
async function ensurePlayerOnce(db: Queries, discordId: string, name: string): Promise<EnsuredPlayer> {
  const logParameters = JSON.stringify({ discord_id: discordId, name, source: "website login" });
  const record = await db.row<EnsuredPlayerRecord>(sql`
    BEGIN TRANSACTION;
    DECLARE @discordId NVARCHAR(25) = ${t.nvarchar(discordId, 25)};
    DECLARE @playerId INT = NULL;
    DECLARE @created BIT = 0;
    SELECT TOP 1 @playerId = ID FROM dbo.Player WITH (UPDLOCK, HOLDLOCK) WHERE DiscordID = @discordId ORDER BY ID;
    IF @playerId IS NULL
    BEGIN
      INSERT INTO dbo.Player (Name, DiscordID) VALUES (${t.nvarchar(name, 100)}, @discordId);
      SET @playerId = CONVERT(INT, SCOPE_IDENTITY());
      SET @created = 1;
      INSERT INTO dbo.CommandLog (Command, Parameters)
      VALUES (N'WebsiteCreatePlayer', ${t.nvarchar(logParameters, 4000)});
    END;
    COMMIT TRANSACTION;
    SELECT @playerId AS player_id, @created AS created;
  `);
  if (!record?.player_id) throw new Error("Player profile could not be created.");
  return { playerId: record.player_id, created: record.created };
}

async function fetchPlayerId(db: Queries, discordId: string): Promise<number | null> {
  const record = await db.row<PlayerIdRecord>(sql`
    SELECT TOP 1 ID AS player_id FROM dbo.Player WHERE DiscordID = ${t.nvarchar(discordId, 25)} ORDER BY ID;
  `);
  return record?.player_id ?? null;
}

/** dbo.Enumeration's countries, the code in lower case; a row without a code is left out. */
async function fetchCountries(db: Queries): Promise<CountryOption[]> {
  const rows = await db.rows<CountryRecord>(sql`
    SELECT Code, Description FROM dbo.Enumeration WHERE Type = N'country';
  `);
  return rows
    .map((row) => ({ code: normalizeText(row.Code).toLowerCase(), name: normalizeText(row.Description) }))
    .filter((row) => row.code !== "");
}

/**
 * The profile batch. With `lock` (a save), the player, the codes and the selected title stay under update locks
 * until the transaction ends, so nothing changes them between the decision and the writes. With `taken`, it also
 * reads which of these codes other players have in the same game.
 */
function profileStatement(playerId: number, lock: boolean, taken: readonly CodeKey[]): Statement {
  const hint = lock ? sql` WITH (UPDLOCK, HOLDLOCK)` : sql``;
  const pairs = taken.map((key) => sql`(fc.GameType = ${key.gameType} AND fc.Code = ${t.nvarchar(key.code, 17)})`);
  const takenCodes = pairs.length
    ? sql`
      SELECT fc.GameType, fc.Code
      FROM dbo.FriendCodes fc
      WHERE fc.Player <> @playerId AND (${sql.join(pairs, " OR ")});`
    : sql``;
  return sql`
    DECLARE @playerId INT = ${playerId};
    SELECT p.Country AS country FROM dbo.Player p${hint} WHERE p.ID = @playerId;
    SELECT fc.GameType, fc.Region, fc.LineSeq, fc.Label, fc.Code
    FROM dbo.FriendCodes fc${hint}
    WHERE fc.Player = @playerId
    ORDER BY fc.GameType, fc.Region, fc.LineSeq;
    SELECT a.TitleId FROM dbo.PlayerActiveTitle a${hint} WHERE a.PlayerId = @playerId;
    SELECT u.TitleId FROM dbo.PlayerTitleUnlock u WHERE u.PlayerId = @playerId;
    SELECT x.TitleId FROM dbo.PlayerTitleTestUnlock x WHERE x.PlayerId = @playerId;
    ${takenCodes}
  `;
}

async function fetchProfile(
  db: Queries,
  playerId: number,
  catalog: readonly CatalogTitle[],
  options: { readonly lock: boolean; readonly taken?: readonly CodeKey[] },
): Promise<{ profile: StoredProfile; taken: CodeKey[] }> {
  const [players, codes, activeTitles, unlocks, testUnlocks, taken = []] = (await db.sets(
    profileStatement(playerId, options.lock, options.taken ?? []),
  )) as ProfileSets;
  const [player] = players;
  if (!player) throw new Error(`Player ${playerId} not found.`);
  const unlocked = unlocks.map((row) => row.TitleId);
  const holder = { playerId, testUnlockedIds: testUnlocks.map((row) => row.TitleId) };
  const selected = selectedTitle(catalog, unlocked, activeTitles[0]?.TitleId ?? null, holder);
  return {
    profile: {
      playerId,
      country: player.country?.trim() ?? "",
      codes: codes.map((row) => ({
        gameType: row.GameType,
        region: normalizeText(row.Region),
        lineSeq: row.LineSeq,
        label: normalizeText(row.Label),
        code: normalizeText(row.Code),
      })),
      title: selected?.code ?? "",
      titles: availableTitles(catalog, unlocked, holder).map(toTitleOption),
    },
    taken: taken.map((row) => ({ gameType: row.GameType, code: normalizeText(row.Code) })),
  };
}

/** The writes of a plan as one batch, in the plan's order (kept rows ascending, so no key collides), then the log. */
function planStatement(playerId: number, plan: ChangePlan, audit: string): Statement {
  // A friend code's key: the player's line in one game and region.
  const key = (row: StoredFriendCode): Statement =>
    sql`Player = @playerId AND GameType = ${row.gameType} AND Region = ${t.nvarchar(row.region, 4)}
      AND LineSeq = ${row.lineSeq}`;
  const statements = [sql`DECLARE @playerId INT = ${playerId};`];
  if (plan.country !== null) {
    statements.push(sql`UPDATE dbo.Player SET Country = ${t.nvarchar(plan.country, 25)} WHERE ID = @playerId;`);
  }
  for (const row of plan.deletes) {
    statements.push(sql`DELETE FROM dbo.FriendCodes WHERE ${key(row)};`);
  }
  for (const { row, label, lineSeq } of plan.updates) {
    statements.push(
      sql`UPDATE dbo.FriendCodes SET Label = ${t.nvarchar(label, 50)}, LineSeq = ${lineSeq} WHERE ${key(row)};`,
    );
  }
  for (const row of plan.inserts) {
    statements.push(sql`INSERT INTO dbo.FriendCodes (Player, GameType, LineSeq, Region, Label, Code)
      VALUES (@playerId, ${row.gameType}, ${row.lineSeq}, ${t.nvarchar(row.region, 4)}, ${t.nvarchar(row.label, 50)},
        ${t.nvarchar(row.code, 17)});`);
  }
  // A title of "" only removes the selected one.
  if (plan.title !== null) {
    statements.push(sql`DELETE FROM dbo.PlayerActiveTitle WHERE PlayerId = @playerId;`);
    if (plan.title) {
      statements.push(sql`INSERT INTO dbo.PlayerActiveTitle (PlayerId, TitleId)
        SELECT @playerId, t.Id FROM dbo.PlayerTitle t WHERE t.Code = ${t.varchar(plan.title, 64)};`);
    }
  }
  statements.push(
    sql`INSERT INTO dbo.CommandLog (Command, Parameters) VALUES (N'WebsiteProfileSave', ${t.nvarchar(audit, 4000)});`,
  );
  return sql.join(statements, "\n");
}

export function createSqlProfileStore(database: Database, titles: Pick<TitleCatalog, "get">): ProfileStore {
  let countries: { readonly at: number; readonly rows: Promise<readonly CountryOption[]> } | null = null;

  return {
    async ensurePlayer(discordId, name) {
      try {
        return await ensurePlayerOnce(database, discordId, name);
      } catch (error) {
        // Another writer (a bot) inserted the same Discord id at the same moment: use its row.
        if (!isUniqueViolation(error)) throw error;
        return ensurePlayerOnce(database, discordId, name);
      }
    },

    findPlayerId(discordId) {
      return fetchPlayerId(database, discordId);
    },

    async readProfile(playerId) {
      const catalog = await titles.get();
      return (await fetchProfile(database, playerId, catalog, { lock: false })).profile;
    },

    countries() {
      if (countries && Date.now() - countries.at < COUNTRIES_TTL_MS) return countries.rows;
      const rows = fetchCountries(database).catch((error: unknown) => {
        countries = null;
        throw error;
      });
      countries = { at: Date.now(), rows };
      return rows;
    },

    async saveProfile(playerId, codes, decide) {
      const catalog = await titles.get();
      return database.transaction(async (tx) => {
        const { profile, taken } = await fetchProfile(tx, playerId, catalog, { lock: true, taken: codes });
        const decision = decide(profile, taken);
        if (decision.plan) await tx.execute(planStatement(playerId, decision.plan, decision.audit));
        return decision.result;
      });
    },
  };
}
