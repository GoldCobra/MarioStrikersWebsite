// The home page season clocks: the Berlin wall-clock cycle (also across daylight saving time), the
// competitive season phases and the countdown digits.

import assert from "node:assert/strict";
import test from "node:test";
import {
  competitiveSeasonImageName,
  competitiveSeasonPhase,
  countdownSegmentsHtml,
  localSeasonPhase,
} from "./season-clock.ts";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const at = (iso: string): number => new Date(iso).getTime();

test("the local cycle starts with three days of off-season, then four days of season", () => {
  assert.deepEqual(localSeasonPhase(at("2026-04-27T10:00:00+02:00")), {
    headline: "OFF-SEASON",
    prefix: "SEASON BEGINS:",
    remainingMs: 3 * DAY_MS,
  });
  assert.deepEqual(localSeasonPhase(at("2026-04-30T10:00:00+02:00")), {
    headline: "THE SEASON IS UNDERWAY!",
    prefix: "SEASON ENDS IN",
    remainingMs: 4 * DAY_MS,
  });
  assert.equal(localSeasonPhase(at("2026-05-04T09:59:59+02:00")).remainingMs, 1000);
});

test("the local cycle follows Berlin wall-clock time across daylight saving time", () => {
  // 27 weeks after the anchor, in winter time: again 10:00 in Berlin, again the start of the cycle.
  assert.deepEqual(localSeasonPhase(at("2026-11-02T10:00:00+01:00")), {
    headline: "OFF-SEASON",
    prefix: "SEASON BEGINS:",
    remainingMs: 3 * DAY_MS,
  });
  // Before the anchor the cycle runs backwards the same way.
  assert.equal(localSeasonPhase(at("2026-04-20T10:00:00+02:00")).headline, "OFF-SEASON");
});

test("the competitive season counts to its start, then its end, then shows it ended", () => {
  const season = {
    displayName: " Rise 2026 ",
    startDateUtc: "2026-10-01T00:00:00Z",
    endDateUtc: "2026-10-29T00:00:00Z",
  };
  assert.deepEqual(competitiveSeasonPhase(season, at("2026-09-30T00:00:00Z")), {
    headline: "Rise 2026",
    prefix: "SEASON BEGINS:",
    remainingMs: DAY_MS,
    targetMs: at("2026-10-01T00:00:00Z"),
  });
  assert.equal(competitiveSeasonPhase(season, at("2026-10-28T00:00:00Z")).prefix, "SEASON ENDS IN");
  assert.deepEqual(competitiveSeasonPhase(season, at("2026-11-01T00:00:00Z")), {
    headline: "Rise 2026",
    prefix: "SEASON ENDED:",
    remainingMs: 0,
    targetMs: at("2026-10-29T00:00:00Z"),
  });
  assert.deepEqual(competitiveSeasonPhase({}, 0), {
    headline: "COMPETITIVE SEASON",
    prefix: "SEASON ENDED:",
    remainingMs: 0,
    targetMs: 0,
  });
});

test("the season artwork is chosen by the first word of the season name", () => {
  assert.equal(competitiveSeasonImageName("Rise 2026"), "rise");
  assert.equal(competitiveSeasonImageName("  CHILL"), "chill");
  assert.equal(competitiveSeasonImageName("Winter 2026"), "");
  assert.equal(competitiveSeasonImageName(null), "");
});

test("countdowns show days, hours and minutes, and under a day hours, minutes and seconds", () => {
  const digits = (html: string): string => html.replace(/<[^>]+>/g, "");
  assert.equal(digits(countdownSegmentsHtml(DAY_MS + HOUR_MS + 61_000)), "01D01H01M");
  assert.equal(digits(countdownSegmentsHtml(HOUR_MS + 61_000)), "01H01M01S");
  assert.equal(digits(countdownSegmentsHtml(-5)), "00H00M00S");
  assert.ok(
    countdownSegmentsHtml(0).startsWith(
      '<span class="landing-countdown-segment"><span class="landing-countdown-char">0</span><span class="landing-countdown-char">0</span><span class="landing-countdown-char landing-countdown-char-unit">H</span></span>',
    ),
  );
});
