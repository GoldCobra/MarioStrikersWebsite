// The competitive season shown on the home page countdown: the active one, else the next to start.

import { normalizeText } from "@ms/shared/text";
import type { Queries, Row } from "../../db/database.ts";
import { sql } from "../../db/sql.ts";

export interface Season {
  id: number;
  seasonNumber: number;
  displayName: string;
  startDateUtc: string | null;
  endDateUtc: string | null;
  isActive: boolean;
  isCompleted: boolean;
  lifecycleStatus: string;
}

export interface SeasonStatus {
  serverNowUtc: string;
  season: Season | null;
}

/** The server's clock and the candidate season, whose columns are null when no season qualifies. */
interface SeasonStatusRecord extends Row {
  ServerNowUtc: Date;
  Id: number | null;
  SeasonNumber: number | null;
  DisplayName: string | null;
  StartDateUtc: Date | null;
  EndDateUtc: Date | null;
  IsActive: boolean | null;
  IsCompleted: boolean | null;
  LifecycleStatus: string | null;
}

// The seed row keeps the server's clock in the result when no season qualifies.
const SEASON_STATUS_QUERY = sql`
  DECLARE @now datetime2 = SYSUTCDATETIME();

  WITH Candidate AS (
    SELECT TOP (1)
      Id,
      SeasonNumber,
      DisplayName,
      StartDateUtc,
      EndDateUtc,
      IsActive,
      IsCompleted,
      LifecycleStatus
    FROM rocci121_toby.CompetitiveSeason
    WHERE IsCompleted = 0
      AND (
        IsActive = 1
        OR (@now >= StartDateUtc AND @now < EndDateUtc)
        OR StartDateUtc > @now
      )
    ORDER BY
      CASE
        WHEN IsActive = 1 THEN 0
        WHEN @now >= StartDateUtc AND @now < EndDateUtc THEN 1
        WHEN StartDateUtc > @now THEN 2
        ELSE 3
      END ASC,
      CASE
        WHEN StartDateUtc > @now THEN StartDateUtc
        ELSE EndDateUtc
      END ASC,
      StartDateUtc ASC,
      Id ASC
  )
  SELECT
    @now AS ServerNowUtc,
    Candidate.Id,
    Candidate.SeasonNumber,
    Candidate.DisplayName,
    Candidate.StartDateUtc,
    Candidate.EndDateUtc,
    Candidate.IsActive,
    Candidate.IsCompleted,
    Candidate.LifecycleStatus
  FROM (SELECT 1 AS OneRow) AS Seed
  LEFT JOIN Candidate ON 1 = 1;
`;

function toIsoStringOrNull(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export function mapSeasonRow(row: Record<string, unknown> | null | undefined): Season | null {
  if (row?.Id === null || row?.Id === undefined) return null;
  return {
    id: Number(row.Id),
    seasonNumber: Number(row.SeasonNumber),
    displayName: normalizeText(row.DisplayName),
    startDateUtc: toIsoStringOrNull(row.StartDateUtc),
    endDateUtc: toIsoStringOrNull(row.EndDateUtc),
    isActive: toBoolean(row.IsActive),
    isCompleted: toBoolean(row.IsCompleted),
    lifecycleStatus: normalizeText(row.LifecycleStatus),
  };
}

export async function getCompetitiveSeasonStatus(db: Queries): Promise<SeasonStatus> {
  const row = await db.row<SeasonStatusRecord>(SEASON_STATUS_QUERY);
  return { serverNowUtc: toIsoStringOrNull(row?.ServerNowUtc) ?? new Date().toISOString(), season: mapSeasonRow(row) };
}
