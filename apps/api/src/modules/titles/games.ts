// The game a title belongs to (dbo.PlayerTitle.GameCode): the codes of rocci121_toby.CompetitiveGame and the
// ids that dbo.Tournament.GameType, dbo.PlayerStats.GameType and CompetitiveGame.Id share (1 MSC, 2 SMS,
// 3 MSBL). A title without a game has "". The order is the site's (Season Rewards: MSBL, MSC, SMS).

import { toText } from "@ms/shared/text";

export type TitleGameCode = "MSBL" | "MSC" | "SMS";

export interface TitleGame {
  readonly code: TitleGameCode;
  readonly gameType: number;
  /** Appended to a title code for its variant of this game ("tournament-winner-msbl"). */
  readonly suffix: string;
}

export const TITLE_GAMES: readonly TitleGame[] = [
  { code: "MSBL", gameType: 3, suffix: "msbl" },
  { code: "MSC", gameType: 1, suffix: "msc" },
  { code: "SMS", gameType: 2, suffix: "sms" },
];

/** A game code as stored or sent; "" for none or anything unknown. */
export function titleGameCode(value: unknown): TitleGameCode | "" {
  const code = toText(value).trim().toUpperCase();
  return TITLE_GAMES.find((game) => game.code === code)?.code ?? "";
}

export function gameByCode(code: unknown): TitleGame | null {
  const known = titleGameCode(code);
  return TITLE_GAMES.find((game) => game.code === known) ?? null;
}

export function gameByType(gameType: number): TitleGame | null {
  return TITLE_GAMES.find((game) => game.gameType === gameType) ?? null;
}

/** "MSC" for GameType 1 …; the bare number for anything else, as open points name it. */
export function gameLabel(gameType: number): string {
  return gameByType(gameType)?.code ?? `game ${String(gameType)}`;
}

/** Position in the site's game order; titles without a game after all games. */
export function gameRank(code: unknown): number {
  const known = titleGameCode(code);
  const index = TITLE_GAMES.findIndex((game) => game.code === known);
  return index < 0 ? TITLE_GAMES.length : index;
}
