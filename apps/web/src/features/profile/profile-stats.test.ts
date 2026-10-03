// MY PROFILE's statistics: the fields per game, their order and how a value or its absence is shown.

import assert from "node:assert/strict";
import test from "node:test";
import { NO_VALUE, STATS_GAMES, profileStatsHtml, statsRows, type ProfileStatsResponse } from "./profile-stats.ts";

const STATS: ProfileStatsResponse = {
  season: "Dusk Season 2026",
  games: [
    {
      game: "MSBL",
      season_rank: "Gold III",
      season_elo: 1187,
      season_wins: 14,
      season_losses: 6,
      highest_season_rank: "Platinum II",
      current_whr: 1612,
      highest_whr: 1688,
      total_wins: 212,
      total_losses: 131,
      total_matches: 343,
      total_win_percent: 61.8,
      highest_legacy_rank: "Megastriker",
    },
    {
      game: "SMS",
      season_rank: "Unranked",
      season_elo: 500,
      season_wins: 0,
      season_losses: 0,
      highest_season_rank: null,
      current_whr: null,
      highest_whr: null,
      total_wins: 0,
      total_losses: 0,
      total_matches: 0,
      total_win_percent: null,
      highest_legacy_rank: null,
    },
  ],
};

test("every game has the same ten fields in the owner's order", () => {
  assert.deepEqual(STATS_GAMES, ["MSBL", "MSC", "SMS"]);
  const labels = statsRows(STATS, "MSBL").map((row) => row.label);
  assert.deepEqual(labels, [
    "Season Rank",
    "Season ELO",
    "Season W/L",
    "Highest Season Rank",
    "Current WHR",
    "Highest WHR",
    "Total W/L",
    "Total Matches",
    "Total Win %",
    "Highest Legacy Rank",
  ]);
  for (const game of STATS_GAMES) {
    assert.deepEqual(
      statsRows(STATS, game).map((row) => row.label),
      labels,
    );
  }
});

test("values: W-L, whole numbers and the win rate with one decimal and a percent sign", () => {
  assert.deepEqual(
    statsRows(STATS, "MSBL").map((row) => row.value),
    ["Gold III", "1187", "14-6", "Platinum II", "1612", "1688", "212-131", "343", "61.8%", "Megastriker"],
  );
});

test("real zeros stay; missing values and a win rate without matches show '-'", () => {
  assert.deepEqual(
    statsRows(STATS, "SMS").map((row) => row.value),
    ["Unranked", "500", "0-0", NO_VALUE, NO_VALUE, NO_VALUE, "0-0", "0", NO_VALUE, NO_VALUE],
  );
  // No data for the game at all, and no statistics at all.
  assert.ok(statsRows(STATS, "MSC").every((row) => row.value === NO_VALUE));
  assert.ok(statsRows(null, "MSBL").every((row) => row.value === NO_VALUE));
  // A rate sent for zero matches is still undefined.
  const odd = { games: [{ game: "MSC", total_wins: 0, total_losses: 0, total_matches: 0, total_win_percent: 0 }] };
  assert.equal(statsRows(odd, "MSC").find((row) => row.label === "Total Win %")?.value, NO_VALUE);
  assert.equal(statsRows(odd, "MSC").find((row) => row.label === "Total W/L")?.value, "0-0");
});

test("the win rate keeps its one decimal, also for a whole number", () => {
  const rate = (total_win_percent: number) =>
    statsRows({ games: [{ game: "SMS", total_matches: 20, total_win_percent }] }, "SMS").find(
      (row) => row.label === "Total Win %",
    )?.value;
  assert.deepEqual(
    [rate(65), rate(100), rate(0), rate(50.3), rate(42.9)],
    ["65.0%", "100.0%", "0.0%", "50.3%", "42.9%"],
  );
});

test("three areas, each field with its game's ball, values in grey field boxes", () => {
  const html = profileStatsHtml({ games: [] });
  for (const game of ["msbl", "msc", "sms"]) {
    assert.match(html, new RegExp(`data-stats-game="${game}"[^>]*><h3 id="profile-stats-${game}"`));
    assert.equal(html.split(`${game}ball.webp`).length - 1, 10, game);
  }
  assert.equal(html.split('class="player-popup-code-row profile-stat-value"').length - 1, 30);
  assert.ok(
    html.indexOf("MSBL Stats") < html.indexOf("MSC Stats") && html.indexOf("MSC Stats") < html.indexOf("SMS Stats"),
  );
  assert.doesNotMatch(html, /<input|contenteditable|data-edit/, "read-only");
});
