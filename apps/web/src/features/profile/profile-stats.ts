// MY PROFILE's statistics (owner, 2026-10-03): one area per game - MSBL, MSC, SMS, always all three - with the
// same ten read-only fields, each value in a grey field box, right-aligned. They take the place of the rating
// cards on /profile only; the player popup, the players page and the Discord card keep their cards. The values
// come from GET /api/profile/me/stats (the signed-in player's own, from the session; modules/profile/stats.ts
// says where each one comes from); a value the API has not (null) shows as "-", a real 0 or 0-0 as such.

import { escapeHtml } from "@ms/shared/html";
import { titleGameBall } from "../players/profile-data.ts";

/** One game as GET /api/profile/me/stats sends it; null = not available. */
export interface StatsGame {
  readonly game?: string;
  readonly season_rank?: string | null;
  readonly season_elo?: number | null;
  readonly season_wins?: number | null;
  readonly season_losses?: number | null;
  readonly highest_season_rank?: string | null;
  readonly current_whr?: number | null;
  readonly highest_whr?: number | null;
  readonly total_wins?: number | null;
  readonly total_losses?: number | null;
  readonly total_matches?: number | null;
  readonly total_win_percent?: number | null;
  readonly highest_legacy_rank?: string | null;
}

export interface ProfileStatsResponse {
  readonly season?: string;
  readonly games?: readonly StatsGame[];
}

export const STATS_GAMES = ["MSBL", "MSC", "SMS"] as const;

/** Shown for a value that is missing or not reliably known. */
export const NO_VALUE = "-";

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function text(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : NO_VALUE;
}

function whole(value: unknown): string {
  return isNumber(value) ? String(Math.round(value)) : NO_VALUE;
}

function record(wins: unknown, losses: unknown): string {
  return isNumber(wins) && isNumber(losses) ? `${String(Math.round(wins))}-${String(Math.round(losses))}` : NO_VALUE;
}

function percent(value: unknown): string {
  return isNumber(value) ? `${value.toFixed(2)}%` : NO_VALUE;
}

/** The fields of a game, in the owner's order, as label and shown value. */
export const STATS_FIELDS: readonly (readonly [label: string, value: (game: StatsGame) => string])[] = [
  ["Season Rank", (game) => text(game.season_rank)],
  ["Season ELO", (game) => whole(game.season_elo)],
  ["Season W/L", (game) => record(game.season_wins, game.season_losses)],
  ["Highest Season Rank", (game) => text(game.highest_season_rank)],
  ["Current WHR", (game) => whole(game.current_whr)],
  ["Highest WHR", (game) => whole(game.highest_whr)],
  ["Total W/L", (game) => record(game.total_wins, game.total_losses)],
  ["Total Matches", (game) => whole(game.total_matches)],
  // No win rate without a match: W / (W + L) is undefined there, whatever the API sends.
  [
    "Total Win %",
    (game) => (isNumber(game.total_matches) && game.total_matches > 0 ? percent(game.total_win_percent) : NO_VALUE),
  ],
  ["Highest Legacy Rank", (game) => text(game.highest_legacy_rank)],
];

/** The fields of one game ("-" for each one the response has not). */
export function statsRows(stats: ProfileStatsResponse | null, game: string): { label: string; value: string }[] {
  const entry = stats?.games?.find((candidate) => candidate.game === game) ?? {};
  return STATS_FIELDS.map(([label, value]) => ({ label, value: value(entry) }));
}

/** The game's ball before each field's name; decorative, as the area's heading names the game. */
function ballHtml(game: string): string {
  const ball = titleGameBall(game);
  if (!ball) return "";
  return `<img class="profile-stat-ball" src="${escapeHtml(ball.src)}" alt="" aria-hidden="true" width="16" height="16" decoding="async" data-fallback-src="${escapeHtml(ball.fallback)}">`;
}

export function profileStatsHtml(stats: ProfileStatsResponse | null): string {
  return STATS_GAMES.map((game) => {
    const id = `profile-stats-${game.toLowerCase()}`;
    const rows = statsRows(stats, game)
      .map(
        ({ label, value }) =>
          '<div class="profile-stat-row">' +
          `<dt class="profile-stat-label">${ballHtml(game)}<span class="profile-stat-name">${escapeHtml(label)}</span></dt>` +
          `<dd class="player-popup-code-row profile-stat-value"><span class="player-popup-code-value">${escapeHtml(value)}</span></dd>` +
          "</div>",
      )
      .join("");
    return (
      `<section class="player-popup-section profile-stats-game" data-stats-game="${game.toLowerCase()}" aria-labelledby="${id}">` +
      `<h3 id="${id}" class="player-popup-section-title">${game} Stats</h3>` +
      `<dl class="player-popup-code-list profile-stats-list">${rows}</dl>` +
      "</section>"
    );
  }).join("");
}

/** The three areas into `mount`; a short note instead when the statistics could not be loaded. */
export function renderProfileStats(mount: HTMLElement, stats: ProfileStatsResponse | null): void {
  mount.innerHTML = stats
    ? profileStatsHtml(stats)
    : '<p class="profile-edit-notice profile-stats-unavailable">Your statistics could not be loaded right now. Please try again later.</p>';
}
