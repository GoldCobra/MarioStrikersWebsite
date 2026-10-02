// Player profiles as the API sends them, and the readings the profile page and the player popup share.

import { toText } from "@ms/shared/text";
import type { Ratings } from "../rating-cards/rating-cards.ts";

export interface FriendCodes {
  readonly switch?: unknown;
  readonly msc?: unknown;
  readonly msc_pal?: unknown;
  readonly msc_ntsc?: unknown;
  readonly msc_jpn?: unknown;
  readonly msc_kor?: unknown;
}

export interface SeasonAward {
  readonly game_code?: unknown;
  readonly season_name?: unknown;
  readonly award_name?: unknown;
}

export interface Accolade {
  readonly game_code?: unknown;
  readonly place_medal?: unknown;
  readonly tournament_name?: unknown;
  readonly start_date?: unknown;
  readonly is_winner?: unknown;
  readonly is_world_champion?: unknown;
}

export interface ProfilePlayer {
  readonly name?: unknown;
  readonly country?: unknown;
  readonly club_name?: unknown;
  readonly club_tag?: unknown;
  readonly results_url?: unknown;
  /** The selected player title, in FULL CAPS; "" for none. */
  readonly title?: unknown;
  /** Its look (colour and glow, titleLookClass); "" without a title. */
  readonly title_style?: unknown;
  /** Its game ("MSBL", "MSC", "SMS"), shown as that game's ball before it; "" for none. */
  readonly title_game_code?: unknown;
}

export interface PlayerProfile {
  readonly player?: ProfilePlayer | null;
  readonly friend_codes?: FriendCodes | null;
  readonly season_awards?: readonly SeasonAward[] | null;
  readonly accolades?: readonly Accolade[] | null;
  readonly ratings?: Ratings | null;
}

export function hasDisplayText(value: unknown): boolean {
  const trimmed = toText(value).trim();
  return trimmed !== "" && trimmed !== "-";
}

/** "PAL: 1234-5678" → prefix "PAL:", code "1234-5678". */
export function parseCodeLine(lineValue: unknown): { prefix: string; code: string } {
  const line = toText(lineValue).trim();
  if (!line) return { prefix: "", code: "-" };
  const index = line.indexOf(":");
  if (index <= 0) return { prefix: "", code: line };
  return { prefix: line.slice(0, index + 1).trim(), code: line.slice(index + 1).trim() || "-" };
}

function lines(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

export function switchFriendCodeLines(data: FriendCodes): string[] {
  return lines(data.switch)
    .filter(hasDisplayText)
    .map((line) => parseCodeLine(line).code);
}

function regionLines(value: unknown, region: string): string[] {
  return lines(value)
    .filter(hasDisplayText)
    .map((line) => `${region}: ${parseCodeLine(line).code}`);
}

/** MSC codes; older profiles keep them per region, which get the region as prefix. */
export function mscFriendCodeLines(data: FriendCodes): unknown[] {
  const msc = lines(data.msc);
  if (msc.some(hasDisplayText)) return msc;
  return [
    ...regionLines(data.msc_pal, "PAL"),
    ...regionLines(data.msc_ntsc, "NTSC-U"),
    ...regionLines(data.msc_jpn, "NTSC-J"),
    ...regionLines(data.msc_kor, "NTSC-K"),
  ];
}

/** An ISO date's day ("2026-03-10"), or the text itself when it is no date. */
export function dateText(value: unknown): string {
  const raw = toText(value).trim();
  if (!raw) return "";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toISOString().slice(0, 10);
}

export function gameBallIconUrl(gameCode: unknown): string {
  const code = toText(gameCode).trim().toLowerCase();
  const ball = code === "msbl" ? "msblball" : code === "msc" ? "mscball" : "smsball";
  return `../assets/nav-buttons/sub/${ball}.webp`;
}

const WINNER_GAMES = new Set(["msbl", "msc", "sms"]);

/** The ball of a title's game, as the accolades and season rewards show it; null for a title without a game. */
export function titleGameBall(gameCode: unknown): { src: string; fallback: string; alt: string } | null {
  const code = toText(gameCode).trim().toLowerCase();
  if (!WINNER_GAMES.has(code)) return null;
  const src = gameBallIconUrl(code);
  return { src, fallback: src.replace(/\.webp$/i, ".png"), alt: code.toUpperCase() };
}

/**
 * A world champion title keeps its gold glow; every other tournament win is tinted in that game's colour
 * instead. Anything below first place stays plain.
 */
export function accoladeNameClasses(baseClass: string, entry: Accolade | null | undefined): string {
  if (entry?.is_world_champion) return `${baseClass} is-world-champion`;
  const game = toText(entry?.game_code).toLowerCase();
  if (entry?.is_winner && WINNER_GAMES.has(game)) return `${baseClass} is-winner-${game}`;
  return baseClass;
}

/** At least one MSL World Championship win: the profile header turns gold and shows the MSL logo. */
export function isWorldChampion(accolades: readonly Accolade[] | null | undefined): boolean {
  return (accolades ?? []).some((entry) => Boolean(entry.is_world_champion));
}

/**
 * The classes of a player title: its type and look (the API's title_style, titles/availability.ts titleLook:
 * colour and glow), set once in styles/player-popup.css (.player-title) for every view that shows a title.
 */
export function titleLookClass(style: unknown): string {
  const look =
    toText(style)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "") || "plain";
  return `player-title is-look-${look}`;
}
