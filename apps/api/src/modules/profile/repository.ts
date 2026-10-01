// SQL of the signed-in player's own profile. A new profile is created in one batch that first locks the
// Discord id's key range (UPDLOCK, HOLDLOCK), so parallel logins wait for each other and reuse the row
// the first one created; the unique index IX_Player_DiscordID stays the last guard against a second row.
// Like the bot's procedures, every creation is written to dbo.CommandLog.

import type { Database } from "../../db/database.ts";
import { mssql } from "../../db/database.ts";
import type { EnsuredPlayer, ProfileStore } from "./service.ts";

type Row = Record<string, unknown>;

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

/** SQL Server's duplicate key errors: unique index (2601) and unique constraint (2627). */
export function isUniqueViolation(error: unknown): boolean {
  const record = (error ?? {}) as { number?: unknown; originalError?: { info?: { number?: unknown } } };
  const number = record.number ?? record.originalError?.info?.number;
  return number === 2601 || number === 2627;
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

export function createSqlProfileStore(database: Pick<Database, "withPool">): ProfileStore {
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
  };
}
