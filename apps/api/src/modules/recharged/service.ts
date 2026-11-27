// The Recharged API's rules and answers (docs/adr/0016, docs/recharged-api.md), without database code: the fixtures
// use them too. A player's MSC 1v1 rating of the active season, the rank ladder, and match reports: checked, stored
// once per match id and key environment, and read back. Reports are not rated here; a test key's never are.

import { HttpError, badRequest } from "../../http/errors.ts";
import type { KeyEnvironment } from "./keys.ts";

/** futbot's PLACEMENT_GAMES_REQUIRED (src/utils/competitiveConstants.js): rated matches before a player has a rank. */
export const PLACEMENT_MATCHES = 5;
/** 1 to 64 characters, compared exactly (the column's collation is binary). */
export const MATCH_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
export const DISCORD_ID = /^\d{15,20}$/;
const PLAYED_AT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const MAX_SCORE = 99;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const MAX_AGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ReportStatus = "pending" | "test" | "rated" | "rejected";

export interface RechargedSeason {
  readonly id: number;
  readonly name: string;
  readonly endsAt: Date | null;
}

export interface RechargedRating {
  readonly elo: number;
  readonly rankNumber: number;
  readonly rankName: string;
  readonly placementPlayed: number;
  readonly placementComplete: boolean;
  readonly wins: number;
  readonly losses: number;
}

/** A player with the MSC 1v1 rating of the active season, as the store reads them. */
export interface RechargedPlayerRecord {
  readonly playerId: number;
  readonly name: string;
  readonly hideStats: boolean;
  /** The active season; null between two seasons. */
  readonly season: RechargedSeason | null;
  /** Null until the player's first rated MSC 1v1 match of the season. */
  readonly rating: RechargedRating | null;
  /** Rank 0 of the ladder: what a player without a rating has. Null only if the ladder lacks it. */
  readonly unranked: { readonly elo: number; readonly name: string } | null;
}

export interface RankRecord {
  readonly rankNumber: number;
  readonly name: string;
  readonly tier: string;
  readonly minElo: number;
}

export interface MatchSide {
  readonly discordId: string;
  readonly score: number;
}

export interface MatchReport {
  readonly environment: KeyEnvironment;
  readonly matchId: string;
  /** Whole seconds, as stored. */
  readonly playedAt: Date;
  readonly player1: MatchSide;
  readonly player2: MatchSide;
}

export interface StoredMatchReport extends MatchReport {
  readonly status: ReportStatus;
  readonly receivedAt: Date;
  readonly processedAt: Date | null;
}

export interface RechargedStore {
  /** Null when no player is linked to the Discord account. */
  findPlayer(discordId: string): Promise<RechargedPlayerRecord | null>;
  /** The active ranks, rank 0 (Unranked) first. */
  listRanks(): Promise<RankRecord[]>;
  /** Stores the report unless its environment already has the match id; answers with the stored report either way. */
  saveReport(report: MatchReport, status: ReportStatus): Promise<{ created: boolean; report: StoredMatchReport }>;
  findReport(environment: KeyEnvironment, matchId: string): Promise<StoredMatchReport | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * The instant of an ISO 8601 time with seconds and an offset, or NaN. Strict where Date.parse is not: it would read
 * 2026-02-30 as 2 March and 24:00 as the next day.
 */
function parseIsoTime(value: unknown): number {
  const match = typeof value === "string" ? PLAYED_AT.exec(value) : null;
  if (!match) return Number.NaN;
  const part = (index: number): number => Number(match[index] ?? "0");
  const year = part(1);
  const month = part(2);
  const day = part(3);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const offsetMinutes = (match[8] === "-" ? -1 : 1) * (part(9) * 60 + part(10));
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return Number.NaN;
  if (part(4) > 23 || part(5) > 59 || part(6) > 59 || part(9) > 23 || part(10) > 59) return Number.NaN;
  const millis = Number((match[7] ?? "").padEnd(3, "0"));
  return Date.UTC(year, month - 1, day, part(4), part(5), part(6), millis) - offsetMinutes * 60_000;
}

function parsePlayedAt(value: unknown, now: number): Date {
  const time = parseIsoTime(value);
  if (!Number.isFinite(time)) {
    throw badRequest("played_at must be an ISO 8601 time with its offset, e.g. 2026-11-27T18:04:11Z.");
  }
  if (time > now + FUTURE_TOLERANCE_MS) throw badRequest("played_at lies in the future.");
  if (time < now - MAX_AGE_DAYS * DAY_MS) throw badRequest(`played_at is more than ${String(MAX_AGE_DAYS)} days ago.`);
  return new Date(Math.floor(time / 1000) * 1000);
}

function parseSide(value: unknown, field: "player1" | "player2"): MatchSide {
  const side = isRecord(value) ? value : {};
  const discordId = side.discord_id;
  if (typeof discordId !== "string" || !DISCORD_ID.test(discordId)) {
    throw badRequest(`${field}.discord_id must be a Discord user id: 15 to 20 digits, sent as a string.`);
  }
  const score = side.score;
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
    throw badRequest(`${field}.score must be a whole number from 0 to ${String(MAX_SCORE)}.`);
  }
  return { discordId, score };
}

/** A report from the request body, checked; `now` limits played_at (at most 5 minutes ahead, 30 days back). */
export function parseMatchReport(body: unknown, environment: KeyEnvironment, now: number): MatchReport {
  if (!isRecord(body)) throw badRequest("Send the report as a JSON object.");
  const matchId = body.match_id;
  if (typeof matchId !== "string" || !MATCH_ID.test(matchId)) {
    throw badRequest("match_id must be 1 to 64 letters, digits or . _ : -, starting with a letter or digit.");
  }
  const playedAt = parsePlayedAt(body.played_at, now);
  const player1 = parseSide(body.player1, "player1");
  const player2 = parseSide(body.player2, "player2");
  if (player1.discordId === player2.discordId) throw badRequest("player1 and player2 must be different players.");
  if (player1.score === player2.score) throw badRequest("A rated match has a winner: the scores must differ.");
  return { environment, matchId, playedAt, player1, player2 };
}

function sameReport(stored: MatchReport, sent: MatchReport): boolean {
  return (
    stored.playedAt.getTime() === sent.playedAt.getTime() &&
    stored.player1.discordId === sent.player1.discordId &&
    stored.player1.score === sent.player1.score &&
    stored.player2.discordId === sent.player2.discordId &&
    stored.player2.score === sent.player2.score
  );
}

/**
 * Checks and stores a report. Sending the same report again changes nothing and answers with the stored one
 * (created: false), so a delivery can be repeated safely; the same match id with other values is refused (409).
 */
export async function submitMatchReport(
  store: RechargedStore,
  body: unknown,
  environment: KeyEnvironment,
  now: number,
): Promise<{ created: boolean; report: StoredMatchReport }> {
  const report = parseMatchReport(body, environment, now);
  const saved = await store.saveReport(report, environment === "test" ? "test" : "pending");
  if (!saved.created && !sameReport(saved.report, report)) {
    throw new HttpError(409, "MATCH_ID_CONFLICT", "This match_id was already reported with other values.");
  }
  return saved;
}

function toIso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

/** A player without a rating this season stands where futbot starts everyone: rank 0, its ELO, nothing played. */
function newPlayerRating(unranked: RechargedPlayerRecord["unranked"]): RechargedRating {
  if (!unranked) throw new Error("CompetitiveRankThreshold has no active rank 0; a new player has no ELO.");
  const { elo, name } = unranked;
  return { elo, rankNumber: 0, rankName: name, placementPlayed: 0, placementComplete: false, wins: 0, losses: 0 };
}

/** The profile's placement rule (players/mappers.ts, normalizePlacementProgress), so both show the same. */
function placementOf(rating: RechargedRating): { played: number; required: number; complete: boolean } {
  const played = Math.min(PLACEMENT_MATCHES, Math.max(rating.placementPlayed, rating.wins + rating.losses));
  const complete = rating.placementComplete || rating.placementPlayed >= PLACEMENT_MATCHES || rating.rankNumber > 0;
  return { played, required: PLACEMENT_MATCHES, complete };
}

function ratingResponse(season: RechargedSeason, record: RechargedPlayerRecord): Record<string, unknown> {
  const rating = record.rating ?? newPlayerRating(record.unranked);
  return {
    season: { id: season.id, name: season.name, ends_at: toIso(season.endsAt) },
    elo: Math.round(rating.elo),
    rank: { number: rating.rankNumber, name: rating.rankName },
    placement: placementOf(rating),
    wins: rating.wins,
    losses: rating.losses,
  };
}

/** A player as GET /players/:discordId answers; hidden statistics stay hidden, as on the website. */
export function toPlayerResponse(discordId: string, record: RechargedPlayerRecord): Record<string, unknown> {
  return {
    player: {
      discord_id: discordId,
      player_id: record.playerId,
      name: record.name,
      stats_hidden: record.hideStats,
      msc_1v1: record.hideStats || !record.season ? null : ratingResponse(record.season, record),
    },
  };
}

export function toRanksResponse(ranks: readonly RankRecord[]): Record<string, unknown> {
  const unranked = ranks.find((rank) => rank.rankNumber === 0);
  if (!unranked) throw new Error("CompetitiveRankThreshold has no active rank 0.");
  return {
    default_elo: unranked.minElo,
    placement_matches: PLACEMENT_MATCHES,
    ranks: ranks.map((rank) => ({ number: rank.rankNumber, name: rank.name, tier: rank.tier, min_elo: rank.minElo })),
  };
}

export function toReportResponse(report: StoredMatchReport): Record<string, unknown> {
  return {
    match_id: report.matchId,
    environment: report.environment,
    status: report.status,
    played_at: report.playedAt.toISOString(),
    received_at: report.receivedAt.toISOString(),
    processed_at: toIso(report.processedAt),
    player1: { discord_id: report.player1.discordId, score: report.player1.score },
    player2: { discord_id: report.player2.discordId, score: report.player2.score },
  };
}

/** The store of local development and tests: reports in memory, players and ranks given. */
export function createMemoryRechargedStore(options: {
  readonly players: (discordId: string) => RechargedPlayerRecord | null;
  readonly ranks: readonly RankRecord[];
  readonly now: () => number;
}): RechargedStore {
  const reports = new Map<string, StoredMatchReport>();
  const keyOf = (environment: KeyEnvironment, matchId: string): string => `${environment}:${matchId}`;
  return {
    findPlayer: (discordId) => Promise.resolve(options.players(discordId)),
    listRanks: () => Promise.resolve([...options.ranks].sort((a, b) => a.rankNumber - b.rankNumber)),
    saveReport: (report, status) => {
      const key = keyOf(report.environment, report.matchId);
      const existing = reports.get(key);
      if (existing) return Promise.resolve({ created: false, report: existing });
      const stored: StoredMatchReport = { ...report, status, receivedAt: new Date(options.now()), processedAt: null };
      reports.set(key, stored);
      return Promise.resolve({ created: true, report: stored });
    },
    findReport: (environment, matchId) => Promise.resolve(reports.get(keyOf(environment, matchId)) ?? null),
  };
}
