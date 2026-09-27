// SQL of the leaderboards. The competitive ladders come from the CompetitiveLeaderboard view; the
// legacy WHR ladder from the GetRatingsForDiscord procedure, joined to PlayerStats and Player by name.

import { normalizeText, toText } from "@ms/shared/text";
import { mssql, type Pool } from "../../db/database.ts";

/** SQL Server allows 2100 parameters per request; name lists are queried in chunks below that. */
export const NAME_CHUNK_SIZE = 900;

export interface CompetitiveLeaderboardRecord {
  rank: unknown;
  player_id: unknown;
  discord_user_id: unknown;
  display_name: unknown;
  total_matches: unknown;
  total_wins: unknown;
  total_losses: unknown;
  rating: unknown;
  rank_number: unknown;
  competitive_rank: unknown;
  updated_at: unknown;
}

export interface WinsLosses {
  readonly totalWins: number;
  readonly totalLosses: number;
  readonly totalDraws: number;
}

export interface PlayerIdentity {
  readonly playerId: number | null;
  readonly discordUserId: string | null;
}

function recordset<T>(result: { recordset?: unknown }): T[] {
  return Array.isArray(result.recordset) ? (result.recordset as T[]) : [];
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function safeCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

export async function fetchRawRatings(
  pool: Pool,
  gameType: number,
  flags: { readonly doubles: number; readonly isWhr: number },
  playedGameWithinDate: Date | null,
): Promise<{ line?: unknown }[]> {
  const request = pool.request();
  request.input("gametype", mssql.Int, gameType);
  request.input("doubles", mssql.Int, flags.doubles);
  request.input("isWhr", mssql.Int, flags.isWhr);
  let query = "exec GetRatingsForDiscord @gametype, @doubles, @isWhr";
  if (playedGameWithinDate) {
    request.input("playedGameWithinDate", mssql.DateTime, playedGameWithinDate);
    query += ", @playedGameWithinDate";
  }
  return recordset(await request.query(query));
}

export async function fetchCompetitiveLeaderboard(
  pool: Pool,
  gameType: number,
  mode: string,
  limit: number,
  offset: number,
): Promise<CompetitiveLeaderboardRecord[]> {
  const request = pool.request();
  request.input("gametype", mssql.Int, gameType);
  request.input("mode", mssql.VarChar, mode);
  request.input("offset", mssql.Int, offset);
  request.input("limit", mssql.Int, limit);
  const query = [
    "SELECT",
    "  lb.Position AS rank,",
    "  lb.PlayerId AS player_id,",
    "  lb.DiscordId AS discord_user_id,",
    "  lb.PlayerName AS display_name,",
    "  lb.TotalMatches AS total_matches,",
    "  lb.MatchWins AS total_wins,",
    "  lb.MatchLosses AS total_losses,",
    "  lb.Elo AS rating,",
    "  lb.RankNumber AS rank_number,",
    "  lb.RankName AS competitive_rank,",
    "  lb.UpdatedAtUtc AS updated_at",
    "FROM CompetitiveLeaderboard lb",
    "INNER JOIN CompetitiveSeason season ON season.Id = lb.SeasonId",
    "WHERE season.IsActive = 1",
    "  AND season.LifecycleStatus = 'active'",
    "  AND lb.GameType = @gametype",
    "  AND lb.Mode = @mode",
    "  AND ISNULL(lb.RankNumber, 0) > 0",
    "ORDER BY lb.Position ASC, lb.Elo DESC, lb.PlayerName ASC",
    "OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY",
  ].join(" ");
  return recordset(await request.query(query));
}

/** Legacy win/loss records by lower-cased player name. */
export async function fetchWinsLosses(
  pool: Pool,
  gameType: number,
  names: readonly string[],
): Promise<Map<string, WinsLosses>> {
  const map = new Map<string, WinsLosses>();
  for (const namesChunk of chunk(names, NAME_CHUNK_SIZE)) {
    const request = pool.request();
    request.input("gametype", mssql.Int, gameType);
    const parameters = namesChunk.map((name, index) => {
      request.input(`name_${index}`, mssql.NVarChar, name);
      return `@name_${index}`;
    });
    const query = [
      "SELECT p.Name AS name, ps.Wins AS total_wins, ps.Losses AS total_losses, ps.MatchDraws AS total_draws",
      "FROM PlayerStats ps",
      "INNER JOIN Player p ON p.ID = ps.Player",
      "WHERE ps.GameType = @gametype",
      `AND p.Name IN (${parameters.join(",")})`,
    ].join(" ");
    for (const row of recordset<Record<string, unknown>>(await request.query(query))) {
      const key = toText(row.name).trim().toLowerCase();
      if (!key) continue;
      map.set(key, {
        totalWins: safeCount(row.total_wins),
        totalLosses: safeCount(row.total_losses),
        totalDraws: safeCount(row.total_draws),
      });
    }
  }
  return map;
}

/** Player id and Discord id by lower-cased player name. */
export async function fetchPlayerIdentities(
  pool: Pool,
  names: readonly string[],
): Promise<Map<string, PlayerIdentity>> {
  const map = new Map<string, PlayerIdentity>();
  for (const namesChunk of chunk(names, NAME_CHUNK_SIZE)) {
    const request = pool.request();
    const parameters = namesChunk.map((name, index) => {
      request.input(`id_name_${index}`, mssql.NVarChar, name);
      return `@id_name_${index}`;
    });
    const query = [
      "SELECT p.Name AS name, p.ID AS player_id, p.DiscordID AS discord_user_id",
      "FROM Player p",
      `WHERE p.Name IN (${parameters.join(",")})`,
    ].join(" ");
    for (const row of recordset<Record<string, unknown>>(await request.query(query))) {
      const key = toText(row.name).trim().toLowerCase();
      if (!key) continue;
      const discordId = normalizeText(row.discord_user_id);
      const playerId = Number(row.player_id);
      map.set(key, {
        playerId: Number.isFinite(playerId) && playerId > 0 ? Math.floor(playerId) : null,
        discordUserId: discordId || null,
      });
    }
  }
  return map;
}
