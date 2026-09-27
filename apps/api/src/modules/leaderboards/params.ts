// Leaderboard request parameters: which game and mode, and how many rows.

import { normalizeText } from "@ms/shared/text";
import { badRequest } from "../../http/errors.ts";

export const GAME_TYPE_BY_CODE = { msc: 1, sms: 2, msbl: 3 } as const;
export const COMPETITIVE_MODE_BY_CODE = { elo1v1: "1v1", elo2v2: "2v2" } as const;
export const LEGACY_MODE_TO_FLAGS = { whr: { doubles: 0, isWhr: 2 } } as const;

export type GameCode = keyof typeof GAME_TYPE_BY_CODE;
export type ModeCode = keyof typeof COMPETITIVE_MODE_BY_CODE | keyof typeof LEGACY_MODE_TO_FLAGS;

function isGameCode(value: string): value is GameCode {
  return Object.hasOwn(GAME_TYPE_BY_CODE, value);
}

function isModeCode(value: string): value is ModeCode {
  return Object.hasOwn(COMPETITIVE_MODE_BY_CODE, value) || Object.hasOwn(LEGACY_MODE_TO_FLAGS, value);
}

/** Positive limits are floored and capped at maxLimit; anything else uses the fallback. */
export function parseLimit(value: unknown, fallback: number, maxLimit: number): number {
  const parsed = Number(value);
  return !Number.isFinite(parsed) || parsed <= 0 ? fallback : Math.min(Math.floor(parsed), maxLimit);
}

export function parseOffset(value: unknown): number {
  const parsed = Number(value);
  return !Number.isFinite(parsed) || parsed < 0 ? 0 : Math.floor(parsed);
}

export function assertGameAndMode(gameCode: unknown, modeCode: unknown): { game: GameCode; mode: ModeCode } {
  const game = normalizeText(gameCode).toLowerCase();
  const mode = normalizeText(modeCode).toLowerCase();
  if (!isGameCode(game)) throw badRequest("Invalid game code.");
  if (!isModeCode(mode)) throw badRequest("Invalid leaderboard mode.");
  return { game, mode };
}
