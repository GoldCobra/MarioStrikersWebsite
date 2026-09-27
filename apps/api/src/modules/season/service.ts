// The competitive season shown on the home page countdown: the active one, else the next to start.

import { normalizeText } from "@ms/shared/text";
import type { Database } from "../../db/database.ts";

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

const SEASON_STATUS_QUERY = `
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
  FROM CompetitiveSeason
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

export async function getCompetitiveSeasonStatus(database: Pick<Database, "withPool">): Promise<SeasonStatus> {
  const result = await database.withPool((pool) => pool.request().query(SEASON_STATUS_QUERY));
  const rows: unknown[] = Array.isArray(result.recordset) ? result.recordset : [];
  const row = (rows[0] as Record<string, unknown> | undefined) ?? {};
  return { serverNowUtc: toIsoStringOrNull(row.ServerNowUtc) ?? new Date().toISOString(), season: mapSeasonRow(row) };
}
