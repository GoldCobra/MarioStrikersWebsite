// SQL of the MSBL Striker Clubs list and club profiles.

import type { Pool } from "../../db/database.ts";

type Row = Record<string, unknown>;

function recordset(result: { recordset?: unknown }): Row[] {
  return Array.isArray(result.recordset) ? (result.recordset as Row[]) : [];
}

/** Clubs with at least one member, biggest first. */
export async function fetchClubs(pool: Pool): Promise<Row[]> {
  const query = [
    "SELECT",
    "  c.ID AS club_id,",
    "  c.ClanTag AS tag,",
    "  c.ClubName AS name,",
    "  c.JoinConditions AS join_conditions,",
    "  c.IsOpen AS is_open,",
    "  c.Region AS region,",
    "  c.Region2 AS region2,",
    "  c.Region3 AS region3,",
    "  c.ClubCode AS club_code,",
    "  c.ClubCode2 AS club_code2,",
    "  c.ClubCode3 AS club_code3,",
    "  c.Logo AS logo,",
    "  c.Activity AS activity,",
    "  COUNT(cr.Player) AS member_count",
    "FROM Club c",
    "LEFT JOIN ClubRoster cr ON cr.Club = c.ID",
    "GROUP BY c.ID, c.ClanTag, c.ClubName, c.JoinConditions, c.IsOpen, c.Region, c.Region2, c.Region3, c.ClubCode, c.ClubCode2, c.ClubCode3, c.Logo, c.Activity",
    "HAVING COUNT(cr.Player) > 0",
    "ORDER BY COUNT(cr.Player) DESC, LTRIM(RTRIM(ISNULL(c.ClubName, ''))) ASC, LTRIM(RTRIM(ISNULL(c.ClanTag, ''))) ASC",
  ].join(" ");
  return recordset(await pool.request().query(query));
}

export async function fetchClub(pool: Pool, clubId: number): Promise<Row | undefined> {
  const request = pool.request();
  request.input("clubId", clubId);
  const query = [
    "SELECT TOP 1",
    "  c.ID AS club_id,",
    "  c.ClanTag AS tag,",
    "  c.ClubName AS name,",
    "  c.JoinConditions AS join_conditions,",
    "  c.IsOpen AS is_open,",
    "  c.Region AS region,",
    "  c.Region2 AS region2,",
    "  c.Region3 AS region3,",
    "  c.ClubCode AS club_code,",
    "  c.ClubCode2 AS club_code2,",
    "  c.ClubCode3 AS club_code3,",
    "  c.Color1 AS color1,",
    "  c.Color2 AS color2,",
    "  c.Stadium AS stadium,",
    "  c.DiscordServer AS discord_server,",
    "  c.Logo AS logo,",
    "  c.Owner AS owner_raw,",
    "  c.CreatedAtUtc AS created_at",
    "FROM Club c",
    "WHERE c.ID = @clubId",
  ].join(" ");
  return recordset(await request.query(query))[0];
}

export async function fetchRoster(pool: Pool, clubId: number): Promise<Row[]> {
  const request = pool.request();
  request.input("clubId", clubId);
  const query = [
    "SELECT",
    "  p.ID AS player_id,",
    "  p.Name AS name,",
    "  p.Country AS country,",
    "  p.DiscordID AS discord_id,",
    "  cr.IsOfficer AS is_officer",
    "FROM ClubRoster cr",
    "INNER JOIN Player p ON p.ID = cr.Player",
    "WHERE cr.Club = @clubId",
  ].join(" ");
  return recordset(await request.query(query));
}
