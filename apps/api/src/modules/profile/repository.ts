// SQL of the signed-in player's own profile. A new profile is created in one batch that first locks the
// Discord id's key range (UPDLOCK, HOLDLOCK), so parallel logins wait for each other and reuse the row
// the first one created; the unique index IX_Player_DiscordID stays the last guard against a second row.
// A save reads the profile under update locks, decides and writes in one transaction. Like the bot's
// procedures, every creation and every save is written to dbo.CommandLog. The selected title, the
// player's unlocked titles and their temporary test unlocks are read with the profile; the title catalog
// comes from its cache.

import { normalizeText } from "@ms/shared/text";
import type { Database, Queryable } from "../../db/database.ts";
import { mssql } from "../../db/database.ts";
import { toPositiveIntId } from "../../lib/numbers.ts";
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

type Row = Record<string, unknown>;

/** dbo.Enumeration rarely changes; the countries are read once an hour. */
const COUNTRIES_TTL_MS = 60 * 60 * 1000;

export function buildEnsurePlayerQuery(): string {
  return [
    "SET XACT_ABORT ON;",
    "SET NOCOUNT ON;",
    "BEGIN TRANSACTION;",
    "DECLARE @playerId INT = NULL;",
    "DECLARE @created BIT = 0;",
    "SELECT TOP 1 @playerId = ID FROM dbo.Player WITH (UPDLOCK, HOLDLOCK) WHERE DiscordID = @discordId ORDER BY ID;",
    "IF @playerId IS NULL",
    "BEGIN",
    "  INSERT INTO dbo.Player (Name, DiscordID) VALUES (@name, @discordId);",
    "  SET @playerId = CONVERT(INT, SCOPE_IDENTITY());",
    "  SET @created = 1;",
    "  INSERT INTO dbo.CommandLog (Command, Parameters) VALUES (N'WebsiteCreatePlayer', @logParameters);",
    "END;",
    "COMMIT TRANSACTION;",
    "SELECT @playerId AS player_id, @created AS created;",
  ].join(" ");
}

export const FIND_PLAYER_QUERY =
  "SELECT TOP 1 ID AS player_id FROM dbo.Player WHERE DiscordID = @discordId ORDER BY ID;";

export const COUNTRIES_QUERY = "SELECT Code, Description FROM dbo.Enumeration WHERE Type = N'country';";

/** Result set positions of buildProfileQuery() (the taken codes of a save follow them). */
export const PROFILE_SETS = { player: 0, codes: 1, title: 2, unlocks: 3, testUnlocks: 4, taken: 5 } as const;

/** The profile; with `lock`, under update locks held until the transaction ends. */
export function buildProfileQuery(lock: boolean): string {
  const hint = lock ? " WITH (UPDLOCK, HOLDLOCK)" : "";
  return [
    lock ? "SET XACT_ABORT ON;" : "",
    `SELECT p.Country AS country FROM dbo.Player p${hint} WHERE p.ID = @playerId;`,
    "SELECT fc.GameType, fc.Region, fc.LineSeq, fc.Label, fc.Code",
    `FROM dbo.FriendCodes fc${hint}`,
    "WHERE fc.Player = @playerId",
    "ORDER BY fc.GameType, fc.Region, fc.LineSeq;",
    `SELECT a.TitleId FROM dbo.PlayerActiveTitle a${hint} WHERE a.PlayerId = @playerId;`,
    "SELECT u.TitleId FROM dbo.PlayerTitleUnlock u WHERE u.PlayerId = @playerId;",
    "SELECT x.TitleId FROM dbo.PlayerTitleTestUnlock x WHERE x.PlayerId = @playerId;",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Which of these codes other players have in the same game (parameters @takenGame<n>, @takenCode<n>). */
export function buildTakenCodesQuery(count: number): string {
  if (!count) return "";
  const pairs = Array.from(
    { length: count },
    (_, index) => `(fc.GameType = @takenGame${index} AND fc.Code = @takenCode${index})`,
  );
  return `SELECT fc.GameType, fc.Code FROM dbo.FriendCodes fc WHERE fc.Player <> @playerId AND (${pairs.join(" OR ")});`;
}

/** The writes of a plan as one batch; adds its parameters to `request`. */
export function buildApplyQuery(plan: ChangePlan, request: mssql.Request): string {
  const statements: string[] = ["SET XACT_ABORT ON;"];
  const key = (prefix: string, index: number, row: StoredFriendCode): string => {
    request.input(`${prefix}Game${index}`, mssql.Int, row.gameType);
    request.input(`${prefix}Region${index}`, mssql.NVarChar(4), row.region);
    request.input(`${prefix}Seq${index}`, mssql.Int, row.lineSeq);
    return `Player = @playerId AND GameType = @${prefix}Game${index} AND Region = @${prefix}Region${index} AND LineSeq = @${prefix}Seq${index}`;
  };
  if (plan.country !== null) {
    request.input("country", mssql.NVarChar(25), plan.country);
    statements.push("UPDATE dbo.Player SET Country = @country WHERE ID = @playerId;");
  }
  plan.deletes.forEach((row, index) => {
    statements.push(`DELETE FROM dbo.FriendCodes WHERE ${key("del", index, row)};`);
  });
  plan.updates.forEach((update, index) => {
    request.input(`updLabel${index}`, mssql.NVarChar(50), update.label);
    request.input(`updNewSeq${index}`, mssql.Int, update.lineSeq);
    statements.push(
      `UPDATE dbo.FriendCodes SET Label = @updLabel${index}, LineSeq = @updNewSeq${index} WHERE ${key("upd", index, update.row)};`,
    );
  });
  plan.inserts.forEach((row, index) => {
    request.input(`insGame${index}`, mssql.Int, row.gameType);
    request.input(`insSeq${index}`, mssql.Int, row.lineSeq);
    request.input(`insRegion${index}`, mssql.NVarChar(4), row.region);
    request.input(`insLabel${index}`, mssql.NVarChar(50), row.label);
    request.input(`insCode${index}`, mssql.NVarChar(17), row.code);
    statements.push(
      "INSERT INTO dbo.FriendCodes (Player, GameType, LineSeq, Region, Label, Code)" +
        ` VALUES (@playerId, @insGame${index}, @insSeq${index}, @insRegion${index}, @insLabel${index}, @insCode${index});`,
    );
  });
  if (plan.title !== null) {
    statements.push("DELETE FROM dbo.PlayerActiveTitle WHERE PlayerId = @playerId;");
    if (plan.title) {
      request.input("titleCode", mssql.VarChar(64), plan.title);
      statements.push(
        "INSERT INTO dbo.PlayerActiveTitle (PlayerId, TitleId) SELECT @playerId, t.Id FROM dbo.PlayerTitle t WHERE t.Code = @titleCode;",
      );
    }
  }
  statements.push("INSERT INTO dbo.CommandLog (Command, Parameters) VALUES (N'WebsiteProfileSave', @audit);");
  return statements.join(" ");
}

function recordsets(result: { recordsets?: unknown }): Row[][] {
  return Array.isArray(result.recordsets) ? (result.recordsets as Row[][]) : [];
}

function toStoredProfile(playerId: number, sets: Row[][], catalog: readonly CatalogTitle[]): StoredProfile {
  const player = sets[PROFILE_SETS.player]?.[0];
  if (!player) throw new Error(`Player ${playerId} not found.`);
  const unlocked = (sets[PROFILE_SETS.unlocks] ?? []).map((row) => Number(row.TitleId));
  const holder = {
    playerId,
    testUnlockedIds: (sets[PROFILE_SETS.testUnlocks] ?? []).map((row) => Number(row.TitleId)),
  };
  const selected = selectedTitle(catalog, unlocked, toPositiveIntId(sets[PROFILE_SETS.title]?.[0]?.TitleId), holder);
  return {
    playerId,
    country: typeof player.country === "string" ? player.country.trim() : "",
    codes: (sets[PROFILE_SETS.codes] ?? []).map((row) => ({
      gameType: Number(row.GameType),
      region: normalizeText(row.Region),
      lineSeq: Number(row.LineSeq),
      label: normalizeText(row.Label),
      code: normalizeText(row.Code),
    })),
    title: selected?.code ?? "",
    titles: availableTitles(catalog, unlocked, holder).map(toTitleOption),
  };
}

async function ensurePlayerOnce(
  database: Pick<Database, "withPool">,
  discordId: string,
  name: string,
): Promise<EnsuredPlayer> {
  const rows = await database.withPool(async (pool) => {
    const request = pool.request();
    request.input("discordId", mssql.NVarChar(25), discordId);
    request.input("name", mssql.NVarChar(100), name);
    request.input(
      "logParameters",
      mssql.NVarChar(4000),
      JSON.stringify({ discord_id: discordId, name, source: "website login" }),
    );
    const result = await request.query(buildEnsurePlayerQuery());
    return Array.isArray(result.recordset) ? (result.recordset as Row[]) : [];
  });
  const playerId = Number(rows[0]?.player_id);
  if (!Number.isInteger(playerId) || playerId <= 0) throw new Error("Player profile could not be created.");
  return { playerId, created: rows[0]?.created === true || Number(rows[0]?.created) === 1 };
}

async function queryProfile(
  queryable: Queryable,
  playerId: number,
  lock: boolean,
  catalog: readonly CatalogTitle[],
  taken: readonly CodeKey[] = [],
) {
  const request = queryable.request();
  request.multiple = true;
  request.input("playerId", mssql.Int, playerId);
  taken.forEach((key, index) => {
    request.input(`takenGame${index}`, mssql.Int, key.gameType);
    request.input(`takenCode${index}`, mssql.NVarChar(17), key.code);
  });
  const sets = recordsets(await request.query(buildProfileQuery(lock) + " " + buildTakenCodesQuery(taken.length)));
  return {
    profile: toStoredProfile(playerId, sets, catalog),
    taken: taken.length
      ? (sets[PROFILE_SETS.taken] ?? []).map((row) => ({
          gameType: Number(row.GameType),
          code: normalizeText(row.Code),
        }))
      : [],
  };
}

export function createSqlProfileStore(
  database: Pick<Database, "withPool" | "withTransaction">,
  titles: Pick<TitleCatalog, "get">,
): ProfileStore {
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

    async findPlayerId(discordId) {
      const rows = await database.withPool(async (pool) => {
        const request = pool.request();
        request.input("discordId", mssql.NVarChar(25), discordId);
        const result = await request.query(FIND_PLAYER_QUERY);
        return Array.isArray(result.recordset) ? (result.recordset as Row[]) : [];
      });
      const playerId = Number(rows[0]?.player_id);
      return Number.isInteger(playerId) && playerId > 0 ? playerId : null;
    },

    async readProfile(playerId) {
      const catalog = await titles.get();
      return database.withPool(async (pool) => (await queryProfile(pool, playerId, false, catalog)).profile);
    },

    countries() {
      if (countries && Date.now() - countries.at < COUNTRIES_TTL_MS) return countries.rows;
      const rows = database
        .withPool(async (pool) => {
          const result = await pool.request().query(COUNTRIES_QUERY);
          return (Array.isArray(result.recordset) ? (result.recordset as Row[]) : [])
            .map((row) => ({
              code: normalizeText(row.Code).toLowerCase(),
              name: normalizeText(row.Description),
            }))
            .filter((row) => row.code !== "");
        })
        .catch((error: unknown) => {
          countries = null;
          throw error;
        });
      countries = { at: Date.now(), rows };
      return rows;
    },

    async saveProfile(playerId, codes, decide) {
      const catalog = await titles.get();
      return database.withTransaction(async (transaction) => {
        const { profile, taken } = await queryProfile(transaction, playerId, true, catalog, codes);
        const decision = decide(profile, taken);
        if (decision.plan) {
          const request = transaction.request();
          request.input("playerId", mssql.Int, playerId);
          request.input("audit", mssql.NVarChar(4000), decision.audit);
          await request.query(buildApplyQuery(decision.plan, request));
        }
        return decision.result;
      });
    },
  };
}
