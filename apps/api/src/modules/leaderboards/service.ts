// Leaderboard rows: the active season's ELO ladders, and the all-time legacy WHR ladder that futbot
// recalculates. Both produce the same row shape.

import { normalizeText } from "@ms/shared/text";
import type { Queries } from "../../db/database.ts";
import { toPositiveIntOrNull, toSafeCount } from "../../lib/numbers.ts";
import {
  COMPETITIVE_MODE_BY_CODE,
  GAME_TYPE_BY_CODE,
  assertGameAndMode,
  parseLimit,
  parseOffset,
  type GameCode,
} from "./params.ts";
import { fetchCompetitiveLeaderboard, fetchWhrLeaderboard } from "./repository.ts";

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

async function getCompetitiveRows(
  db: Queries,
  game: GameCode,
  mode: string,
  limit: number,
  offset: number,
): Promise<LeaderboardRow[]> {
  const records = await fetchCompetitiveLeaderboard(db, GAME_TYPE_BY_CODE[game], mode, limit, offset);
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

/** The query reads the whole ladder; it is sorted and paged here. A player without a name is not listed. */
async function getWhrRows(db: Queries, game: GameCode, limit: number, offset: number): Promise<LeaderboardRow[]> {
  const activityDays = ACTIVITY_FILTER_DAYS_BY_GAME[game];
  const playedWithin = activityDays === null ? null : new Date();
  playedWithin?.setDate(playedWithin.getDate() - (activityDays ?? 0));

  const records = await fetchWhrLeaderboard(db, GAME_TYPE_BY_CODE[game], playedWithin);
  const updatedAt = new Date().toISOString();
  return records
    .map((record) => ({ ...record, display_name: normalizeText(record.display_name) }))
    .filter((record) => Boolean(record.display_name))
    .sort((a, b) => b.rating - a.rating || a.display_name.localeCompare(b.display_name))
    .slice(offset, offset + limit)
    .map((record, index) => {
      const wins = toSafeCount(record.total_wins);
      const losses = toSafeCount(record.total_losses);
      const draws = toSafeCount(record.total_draws);
      return {
        rank: offset + index + 1,
        player_id: record.player_id,
        discord_user_id: normalizeText(record.discord_user_id) || null,
        display_name: record.display_name,
        total_matches: wins + losses + draws,
        total_wins: wins,
        total_losses: losses,
        total_draws: draws,
        total_game_diff: 0,
        total_goals_for: 0,
        total_goals_against: 0,
        total_goal_diff: 0,
        rating: record.rating,
        // WHR has no rank tiers.
        competitive_rank: "",
        updated_at: updatedAt,
      };
    });
}

export async function getLeaderboardRows(
  db: Queries,
  query: LeaderboardQuery,
  limits: LeaderboardLimits,
): Promise<LeaderboardRow[]> {
  const { game, mode } = assertGameAndMode(query.gameCode, query.modeCode);
  const limit = parseLimit(query.limit, limits.defaultLimit, limits.maxLimit);
  const offset = parseOffset(query.offset);
  return mode === "whr"
    ? getWhrRows(db, game, limit, offset)
    : getCompetitiveRows(db, game, COMPETITIVE_MODE_BY_CODE[mode], limit, offset);
}
