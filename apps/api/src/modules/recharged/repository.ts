// The Recharged API's store on the database (RechargedStore of service.ts, docs/adr/0016). Players and their MSC 1v1
// rating of the active season come from futbot's tables, read only; the match reports live in
// rocci121_toby.ExternalMatchReport (schema.ts). A report is stored in one batch that first locks its match id's key
// range (UPDLOCK, HOLDLOCK), so two deliveries of the same report wait for each other and the second finds the first;
// the unique constraint UQ_ExternalMatchReport_Match stays the last guard.

import type { Queries, Row } from "../../db/database.ts";
import { sql, t } from "../../db/sql.ts";
import { isUniqueViolation } from "../../lib/sql-errors.ts";
import type { KeyEnvironment } from "./keys.ts";
import type {
  MatchReport,
  RankRecord,
  RechargedPlayerRecord,
  RechargedStore,
  ReportStatus,
  StoredMatchReport,
} from "./service.ts";

const ACTIVE_SEASON = sql`season.IsActive = 1 AND season.LifecycleStatus = 'active'`;

const REPORT_COLUMNS = sql.raw(
  "Environment AS environment, ExternalMatchId AS match_id, PlayedAtUtc AS played_at, " +
    "Player1DiscordId AS player1_discord_id, Player1Score AS player1_score, " +
    "Player2DiscordId AS player2_discord_id, Player2Score AS player2_score, " +
    "Status AS status, ReceivedAtUtc AS received_at, ProcessedAtUtc AS processed_at",
);

const REPORT_STATUSES: readonly ReportStatus[] = ["pending", "test", "rated", "rejected"];

interface PlayerRecord extends Row {
  player_id: number;
  name: string;
  hide_stats: boolean;
}

interface SeasonRecord extends Row {
  season_id: number;
  season_name: string;
  ends_at: Date | null;
}

interface RatingRecord extends Row {
  elo: number;
  rank_number: number;
  rank_name: string | null;
  placement_played: number;
  placement_complete: boolean;
  wins: number;
  losses: number;
}

interface UnrankedRecord extends Row {
  elo: number;
  name: string;
}

interface RankRow extends Row {
  rank_number: number;
  name: string;
  tier: string;
  min_elo: number;
}

interface ReportRecord extends Row {
  environment: string;
  match_id: string;
  played_at: Date;
  player1_discord_id: string;
  player1_score: number;
  player2_discord_id: string;
  player2_score: number;
  status: string;
  received_at: Date;
  processed_at: Date | null;
}

interface SavedReportRecord extends ReportRecord {
  created: boolean;
}

function toDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(value as string);
  if (!Number.isFinite(date.getTime())) throw new Error("A match report has an invalid time.");
  return date;
}

function toEnvironment(value: unknown): KeyEnvironment {
  if (value === "test" || value === "live") return value;
  throw new Error("A match report has an unknown environment.");
}

function toStatus(value: unknown): ReportStatus {
  const status = REPORT_STATUSES.find((candidate) => candidate === value);
  if (!status) throw new Error("A match report has an unknown status.");
  return status;
}

function toStoredReport(record: ReportRecord): StoredMatchReport {
  return {
    environment: toEnvironment(record.environment),
    matchId: record.match_id,
    playedAt: toDate(record.played_at),
    player1: { discordId: record.player1_discord_id, score: record.player1_score },
    player2: { discordId: record.player2_discord_id, score: record.player2_score },
    status: toStatus(record.status),
    receivedAt: toDate(record.received_at),
    processedAt: record.processed_at ? toDate(record.processed_at) : null,
  };
}

// Statistics show only for HideStats = 0, as on the profile (players/repository.ts); anything else counts as hidden,
// even a NULL the NOT NULL column cannot hold today.
async function findPlayer(db: Queries, discordId: string): Promise<RechargedPlayerRecord | null> {
  const [players = [], seasons = [], ratings = [], unranked = []] = await db.sets(sql`
    DECLARE @playerId INT = (SELECT TOP 1 ID FROM dbo.Player WHERE DiscordID = ${t.nvarchar(discordId, 25)} ORDER BY ID);
    SELECT p.ID AS player_id, p.Name AS name, CAST(CASE WHEN p.HideStats = 0 THEN 0 ELSE 1 END AS BIT) AS hide_stats
    FROM dbo.Player p WHERE p.ID = @playerId;
    SELECT TOP 1 season.Id AS season_id, season.DisplayName AS season_name, season.EndDateUtc AS ends_at
    FROM rocci121_toby.CompetitiveSeason season
    WHERE ${ACTIVE_SEASON}
    ORDER BY season.Id DESC;
    SELECT TOP 1 rating.Elo AS elo, rating.RankNumber AS rank_number, threshold.Name AS rank_name,
      rating.PlacementPlayed AS placement_played, rating.PlacementComplete AS placement_complete,
      rating.MatchWins AS wins, rating.MatchLosses AS losses
    FROM rocci121_toby.CompetitivePlayerRating rating
    INNER JOIN rocci121_toby.CompetitiveSeason season ON season.Id = rating.SeasonId
    LEFT JOIN rocci121_toby.CompetitiveRankThreshold threshold
      ON threshold.RankNumber = rating.RankNumber AND threshold.IsActive = 1
    WHERE ${ACTIVE_SEASON} AND rating.PlayerId = @playerId AND rating.GameId = 1 AND rating.ModeCode = '1v1'
    ORDER BY season.Id DESC;
    SELECT TOP 1 threshold.MinElo AS elo, threshold.Name AS name
    FROM rocci121_toby.CompetitiveRankThreshold threshold
    WHERE threshold.IsActive = 1 AND threshold.RankNumber = 0;
  `);
  const player = players[0] as PlayerRecord | undefined;
  if (!player) return null;
  const season = seasons[0] as SeasonRecord | undefined;
  const rating = ratings[0] as RatingRecord | undefined;
  const rankZero = unranked[0] as UnrankedRecord | undefined;
  return {
    playerId: player.player_id,
    name: player.name,
    hideStats: player.hide_stats,
    season: season
      ? { id: season.season_id, name: season.season_name, endsAt: season.ends_at ? toDate(season.ends_at) : null }
      : null,
    rating:
      season && rating
        ? {
            elo: rating.elo,
            rankNumber: rating.rank_number,
            rankName: rating.rank_name ?? "",
            placementPlayed: rating.placement_played,
            placementComplete: rating.placement_complete,
            wins: rating.wins,
            losses: rating.losses,
          }
        : null,
    unranked: rankZero ? { elo: rankZero.elo, name: rankZero.name } : null,
  };
}

async function listRanks(db: Queries): Promise<RankRecord[]> {
  const rows = await db.rows<RankRow>(sql`
    SELECT RankNumber AS rank_number, Name AS name, Tier AS tier, MinElo AS min_elo
    FROM rocci121_toby.CompetitiveRankThreshold
    WHERE IsActive = 1
    ORDER BY RankNumber;
  `);
  return rows.map((row) => ({ rankNumber: row.rank_number, name: row.name, tier: row.tier, minElo: row.min_elo }));
}

async function findReport(
  db: Queries,
  environment: KeyEnvironment,
  matchId: string,
): Promise<StoredMatchReport | null> {
  const record = await db.row<ReportRecord>(sql`
    SELECT ${REPORT_COLUMNS}
    FROM rocci121_toby.ExternalMatchReport
    WHERE Source = 'recharged' AND Environment = ${t.varchar(environment, 4)}
      AND ExternalMatchId = ${t.varchar(matchId, 64)};
  `);
  return record ? toStoredReport(record) : null;
}

async function saveReport(
  db: Queries,
  report: MatchReport,
  status: ReportStatus,
): Promise<{ created: boolean; report: StoredMatchReport }> {
  try {
    const record = await db.row<SavedReportRecord>(sql`
      BEGIN TRANSACTION;
      DECLARE @environment VARCHAR(4) = ${t.varchar(report.environment, 4)};
      DECLARE @matchId VARCHAR(64) = ${t.varchar(report.matchId, 64)};
      DECLARE @created BIT = 0;
      IF NOT EXISTS (
        SELECT 1 FROM rocci121_toby.ExternalMatchReport WITH (UPDLOCK, HOLDLOCK)
        WHERE Source = 'recharged' AND Environment = @environment AND ExternalMatchId = @matchId
      )
      BEGIN
        INSERT INTO rocci121_toby.ExternalMatchReport
          (Source, Environment, ExternalMatchId, GameId, ModeCode,
           Player1DiscordId, Player1Score, Player2DiscordId, Player2Score, PlayedAtUtc, Status)
        VALUES ('recharged', @environment, @matchId, 1, '1v1',
          ${t.nvarchar(report.player1.discordId, 25)}, ${t.int(report.player1.score)},
          ${t.nvarchar(report.player2.discordId, 25)}, ${t.int(report.player2.score)},
          ${t.dateTime2(report.playedAt, 0)}, ${t.varchar(status, 10)});
        SET @created = 1;
      END;
      COMMIT TRANSACTION;
      SELECT @created AS created, ${REPORT_COLUMNS}
      FROM rocci121_toby.ExternalMatchReport
      WHERE Source = 'recharged' AND Environment = @environment AND ExternalMatchId = @matchId;
    `);
    if (!record) throw new Error("The match report was not stored.");
    return { created: record.created, report: toStoredReport(record) };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await findReport(db, report.environment, report.matchId);
    if (!existing) throw error;
    return { created: false, report: existing };
  }
}

export function createSqlRechargedStore(db: Queries): RechargedStore {
  return {
    findPlayer: (discordId) => findPlayer(db, discordId),
    listRanks: () => listRanks(db),
    saveReport: (report, status) => saveReport(db, report, status),
    findReport: (environment, matchId) => findReport(db, environment, matchId),
  };
}
