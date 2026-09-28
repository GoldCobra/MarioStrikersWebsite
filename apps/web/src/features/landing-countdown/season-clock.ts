// Season clocks of the home page. The local season runs in a fixed Berlin wall-clock cycle (3 days
// off-season, then 4 days season); the competitive season comes from the API with its own dates.

const BERLIN_TIMEZONE = "Europe/Berlin";
const ANCHOR_UTC_MS = new Date("2026-04-27T10:00:00+02:00").getTime();
const DAY_MS = 24 * 60 * 60 * 1000;
const SEASON_DURATION_MS = 4 * DAY_MS;
const OFFSEASON_DURATION_MS = 3 * DAY_MS;
const CYCLE_DURATION_MS = SEASON_DURATION_MS + OFFSEASON_DURATION_MS;
const COMPETITIVE_SEASON_NAMES = ["rise", "burst", "dusk", "chill"];

const berlinClock = new Intl.DateTimeFormat("en-US", {
  timeZone: BERLIN_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export interface CompetitiveSeason {
  readonly displayName?: unknown;
  readonly startDateUtc?: unknown;
  readonly endDateUtc?: unknown;
}

export interface CountdownPhase {
  readonly headline: string;
  readonly prefix: string;
  readonly remainingMs: number;
}

/** How far Berlin wall-clock time is ahead of UTC at a moment, in ms. */
function berlinOffsetMs(timeMs: number): number {
  const wholeSecondMs = Math.floor(timeMs / 1000) * 1000;
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const part of berlinClock.formatToParts(new Date(wholeSecondMs))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const wallClockMs = Date.UTC(
    parts.year ?? 0,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return wallClockMs - wholeSecondMs;
}

export function localSeasonPhase(nowMs: number): CountdownPhase {
  const elapsedMs = nowMs + berlinOffsetMs(nowMs) - (ANCHOR_UTC_MS + berlinOffsetMs(ANCHOR_UTC_MS));
  const positionMs = ((elapsedMs % CYCLE_DURATION_MS) + CYCLE_DURATION_MS) % CYCLE_DURATION_MS;
  return positionMs < OFFSEASON_DURATION_MS
    ? { headline: "OFF-SEASON", prefix: "SEASON BEGINS:", remainingMs: OFFSEASON_DURATION_MS - positionMs }
    : {
        headline: "THE SEASON IS UNDERWAY!",
        prefix: "SEASON ENDS IN",
        remainingMs: SEASON_DURATION_MS - (positionMs - OFFSEASON_DURATION_MS),
      };
}

/** A time from the API in ms, or 0 when missing or invalid. */
export function timeMs(value: unknown): number {
  const time = new Date(typeof value === "string" || typeof value === "number" ? value : "").getTime();
  return Number.isFinite(time) ? time : 0;
}

/** The competitive countdown, plus the moment it runs out (0 when the season has no dates). */
export function competitiveSeasonPhase(
  season: CompetitiveSeason,
  nowMs: number,
): CountdownPhase & { readonly targetMs: number } {
  const startMs = timeMs(season.startDateUtc);
  const endMs = timeMs(season.endDateUtc);
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- the API sends a string
  const headline = (season.displayName ? String(season.displayName) : "COMPETITIVE SEASON").trim();
  if (startMs && nowMs < startMs) {
    return { headline, prefix: "SEASON BEGINS:", remainingMs: startMs - nowMs, targetMs: startMs };
  }
  if (endMs && nowMs < endMs) {
    return { headline, prefix: "SEASON ENDS IN", remainingMs: endMs - nowMs, targetMs: endMs };
  }
  return { headline, prefix: "SEASON ENDED:", remainingMs: 0, targetMs: endMs || startMs || 0 };
}

/** "rise", "burst", "dusk" or "chill" from a season name such as "Rise 2026", else "". */
export function competitiveSeasonImageName(displayName: unknown): string {
  const firstWord = (typeof displayName === "string" ? displayName : "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return COMPETITIVE_SEASON_NAMES.includes(firstWord) ? firstWord : "";
}

function segmentHtml(value: number, unit: string): string {
  const digits = String(value).padStart(2, "0");
  return (
    '<span class="landing-countdown-segment">' +
    `<span class="landing-countdown-char">${digits.charAt(0)}</span>` +
    `<span class="landing-countdown-char">${digits.charAt(1)}</span>` +
    `<span class="landing-countdown-char landing-countdown-char-unit">${unit}</span>` +
    "</span>"
  );
}

/** Days, hours and minutes; under a day hours, minutes and seconds. */
export function countdownSegmentsHtml(remainingMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, remainingMs) / 1000);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (totalSeconds < 86400) {
    return (
      segmentHtml(Math.floor(totalSeconds / 3600), "H") +
      segmentHtml(minutes, "M") +
      segmentHtml(totalSeconds % 60, "S")
    );
  }
  return (
    segmentHtml(Math.floor(totalSeconds / 86400), "D") +
    segmentHtml(Math.floor((totalSeconds % 86400) / 3600), "H") +
    segmentHtml(minutes, "M")
  );
}
