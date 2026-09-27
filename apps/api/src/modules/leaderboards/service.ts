// Leaderboard rows: the active season's ELO ladders, and the all-time legacy WHR ladder that futbot
// recalculates. Both produce the same row shape.

import { normalizeText, toText } from "@ms/shared/text";
import type { Database } from "../../db/database.ts";
import { toPositiveIntOrNull, toSafeCount } from "../../lib/numbers.ts";
import {
  COMPETITIVE_MODE_BY_CODE,
  GAME_TYPE_BY_CODE,
  LEGACY_MODE_TO_FLAGS,
  assertGameAndMode,
  parseLimit,
  parseOffset,
  type GameCode,
} from "./params.ts";
import { fetchCompetitiveLeaderboard, fetchPlayerIdentities, fetchRawRatings, fetchWinsLosses } from "./repository.ts";
import { normalizeCompetitiveRank } from "./whr-ranks.ts";

export interface LeaderboardRow {
  rank: number;
  player_id: number | null;
  discord_user_id: string | null;
  display_name: string;
  total_matches: number;
  total_wins: number;
  total_losses: number;
  total_draws: number;
  total_game_diff: number;
  total_goals_for: number;
  total_goals_against: number;
  total_goal_diff: number;
  rating: number;
  competitive_rank: string;
  updated_at: string;
}

export interface LeaderboardQuery {
  readonly gameCode: unknown;
  readonly modeCode: unknown;
  readonly limit?: unknown;
  readonly offset?: unknown;
}

export interface LeaderboardLimits {
  readonly defaultLimit: number;
  readonly maxLimit: number;
}

/** MSBL's WHR ladder only lists players with a game in the last 90 days. */
const ACTIVITY_FILTER_DAYS_BY_GAME: Readonly<Record<GameCode, number | null>> = { msbl: 90, sms: null, msc: null };

function toRating(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function toIsoStringOrNow(value: unknown): string {
  if (!value) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function toDisplayCompetitiveRank(value: unknown): string {
  const rank = normalizeText(value);
  return rank.toLowerCase() === "unranked" ? "" : rank;
}

function isVisibleCompetitiveRank(rankName: unknown, rankNumber: unknown): boolean {
  const parsed = Number(rankNumber);
  if (Number.isFinite(parsed)) return parsed > 0;
  const rank = normalizeText(rankName);
  return Boolean(rank) && rank.toLowerCase() !== "unranked";
}

export interface ParsedRatingLine {
  readonly displayName: string;
  readonly rating: number;
  readonly competitiveRank: string;
}

/** Parses a GetRatingsForDiscord line such as "<:rookie:123>`Player Name 1500`". */
export function parseRatingLine(lineValue: unknown): ParsedRatingLine | null {
  const text = toText(lineValue);
  const rankEmoji = /<:([^:>]+):\d+>/i.exec(text);
  const rawRankCode = rankEmoji ? (rankEmoji[1] ?? "").trim().toLowerCase() : "";
  const canonicalRank = normalizeCompetitiveRank(rawRankCode);
  const parts = text.split("`");
  if (parts.length < 2) return null;
  const match = /^(.*?)(-?\d+(?:\.\d+)?)\s*$/.exec((parts[1] ?? "").trim());
  if (!match) return null;
  const displayName = (match[1] ?? "").trim();
  const rating = Number(match[2]);
  if (!displayName || !Number.isFinite(rating)) return null;
  return { displayName, rating, competitiveRank: canonicalRank ? canonicalRank.name : rawRankCode };
}

async function getCompetitiveRows(
  database: Pick<Database, "withPool">,
  game: GameCode,
  mode: string,
  limit: number,
  offset: number,
): Promise<LeaderboardRow[]> {
  const records = await database.withPool((pool) =>
    fetchCompetitiveLeaderboard(pool, GAME_TYPE_BY_CODE[game], mode, limit, offset),
  );
  return records
    .filter((row) => isVisibleCompetitiveRank(row.competitive_rank, row.rank_number))
    .map((row, index) => {
      const wins = toSafeCount(row.total_wins);
      const losses = toSafeCount(row.total_losses);
      const totalMatches = toSafeCount(row.total_matches);
      return {
        rank: offset + index + 1,
        player_id: toPositiveIntOrNull(row.player_id),
        discord_user_id: row.discord_user_id ? normalizeText(row.discord_user_id) : null,
        display_name: normalizeText(row.display_name),
        total_matches: totalMatches || wins + losses,
        total_wins: wins,
        total_losses: losses,
        total_draws: 0,
        total_game_diff: 0,
        total_goals_for: 0,
        total_goals_against: 0,
        total_goal_diff: 0,
        rating: toRating(row.rating),
        competitive_rank: toDisplayCompetitiveRank(row.competitive_rank),
        updated_at: toIsoStringOrNow(row.updated_at),
      };
    })
    .filter((row) => Boolean(row.display_name));
}

async function getWhrRows(
  database: Pick<Database, "withPool">,
  game: GameCode,
  limit: number,
  offset: number,
): Promise<LeaderboardRow[]> {
  const gameType = GAME_TYPE_BY_CODE[game];
  const activityDays = ACTIVITY_FILTER_DAYS_BY_GAME[game];
  const playedWithin = activityDays === null ? null : new Date();
  playedWithin?.setDate(playedWithin.getDate() - (activityDays ?? 0));

  return database.withPool(async (pool) => {
    const parsed = (await fetchRawRatings(pool, gameType, LEGACY_MODE_TO_FLAGS.whr, playedWithin))
      .map((row) => parseRatingLine(row.line))
      .filter((row): row is ParsedRatingLine => row !== null);
    const names = parsed.map((row) => row.displayName);
    const [records, identities] = await Promise.all([
      fetchWinsLosses(pool, gameType, names),
      fetchPlayerIdentities(pool, names),
    ]);
    const updatedAt = new Date().toISOString();
    const merged = parsed.map((row) => {
      const key = row.displayName.toLowerCase();
      const record = records.get(key) ?? { totalWins: 0, totalLosses: 0, totalDraws: 0 };
      const identity = identities.get(key);
      return {
        player_id: identity?.playerId ?? null,
        discord_user_id: identity?.discordUserId ?? null,
        display_name: row.displayName,
        total_matches: record.totalWins + record.totalLosses + record.totalDraws,
        total_wins: record.totalWins,
        total_losses: record.totalLosses,
        total_draws: record.totalDraws,
        rating: row.rating,
        competitive_rank: row.competitiveRank,
      };
    });
    merged.sort((a, b) => b.rating - a.rating || a.display_name.localeCompare(b.display_name));
    return merged.slice(offset, offset + limit).map((row, index) => ({
      rank: offset + index + 1,
      player_id: row.player_id,
      discord_user_id: row.discord_user_id,
      display_name: row.display_name,
      total_matches: row.total_matches,
      total_wins: row.total_wins,
      total_losses: row.total_losses,
      total_draws: row.total_draws,
      total_game_diff: 0,
      total_goals_for: 0,
      total_goals_against: 0,
      total_goal_diff: 0,
      rating: row.rating,
      competitive_rank: row.competitive_rank,
      updated_at: updatedAt,
    }));
  });
}

export async function getLeaderboardRows(
  database: Pick<Database, "withPool">,
  query: LeaderboardQuery,
  limits: LeaderboardLimits,
): Promise<LeaderboardRow[]> {
  const { game, mode } = assertGameAndMode(query.gameCode, query.modeCode);
  const limit = parseLimit(query.limit, limits.defaultLimit, limits.maxLimit);
  const offset = parseOffset(query.offset);
  return mode === "whr"
    ? getWhrRows(database, game, limit, offset)
    : getCompetitiveRows(database, game, COMPETITIVE_MODE_BY_CODE[mode], limit, offset);
}
