const { withPool } = require("../db");

function toIsoString(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? date.toISOString() : null;
}

function toBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function mapSeasonRow(row) {
  if (!row || row.Id === null || row.Id === undefined) {
    return null;
  }

  return {
    id: Number(row.Id),
    seasonNumber: Number(row.SeasonNumber),
    displayName: String(row.DisplayName || "").trim(),
    startDateUtc: toIsoString(row.StartDateUtc),
    endDateUtc: toIsoString(row.EndDateUtc),
    isActive: toBoolean(row.IsActive),
    isCompleted: toBoolean(row.IsCompleted),
    lifecycleStatus: String(row.LifecycleStatus || "").trim()
  };
}

async function getCompetitiveSeasonStatus() {
  return withPool(async function (pool) {
    const result = await pool.request().query(`
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
`);

    const row = result.recordset && result.recordset[0] ? result.recordset[0] : {};
    return {
      serverNowUtc: toIsoString(row.ServerNowUtc) || new Date().toISOString(),
      season: mapSeasonRow(row)
    };
  });
}

module.exports = {
  getCompetitiveSeasonStatus,
  mapSeasonRow,
  toBoolean
};
