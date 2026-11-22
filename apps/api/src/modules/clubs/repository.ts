// SQL of the MSBL Striker Clubs list, club profiles and uploaded logos.

import type { Queries, Row } from "../../db/database.ts";
import { sql } from "../../db/sql.ts";

/** The columns a club's list entry and its profile share, as stored, with the uploaded logo's hash. */
interface ClubColumns extends Row {
  club_id: number;
  tag: string | null;
  name: string | null;
  join_conditions: string | null;
  is_open: boolean | null;
  region: string | null;
  region2: string | null;
  region3: string | null;
  club_code: string | null;
  club_code2: string | null;
  club_code3: string | null;
  logo: string | null;
  logo_hash: string | null;
}

/** A club of the list, with its activity, the new-club counter's inactive mark and the member count. */
export interface ClubListRecord extends ClubColumns {
  activity: Date | null;
  inactive_since: Date | null;
  member_count: number;
}

/** A club profile's club row. */
export interface ClubRecord extends ClubColumns {
  color1: string | null;
  color2: string | null;
  stadium: string | null;
  discord_server: string | null;
  owner_raw: string | null;
  created_at: Date | null;
}

/** A member of a club profile's roster. */
export interface RosterRecord extends Row {
  player_id: number;
  name: string | null;
  country: string | null;
  discord_id: string | null;
  is_officer: boolean | null;
}

export interface UploadedLogoRecord {
  readonly contentType: string;
  readonly hash: string;
  readonly data: Buffer;
}

/** Clubs with at least one member, biggest first, with the new-club counter's inactive mark. */
export function fetchClubs(db: Queries): Promise<ClubListRecord[]> {
  return db.rows<ClubListRecord>(sql`
    SELECT c.ID AS club_id, c.ClanTag AS tag, c.ClubName AS name, c.JoinConditions AS join_conditions,
      c.IsOpen AS is_open, c.Region AS region, c.Region2 AS region2, c.Region3 AS region3,
      c.ClubCode AS club_code, c.ClubCode2 AS club_code2, c.ClubCode3 AS club_code3, c.Logo AS logo,
      c.Activity AS activity, c.InactiveSinceUtc AS inactive_since, l.Hash AS logo_hash, members.member_count
    FROM dbo.Club c
    CROSS APPLY (SELECT COUNT(*) AS member_count FROM dbo.ClubRoster cr WHERE cr.Club = c.ID) members
    LEFT JOIN dbo.ClubLogo l ON l.ClubId = c.ID
    WHERE members.member_count > 0
    ORDER BY members.member_count DESC, LTRIM(RTRIM(ISNULL(c.ClubName, N''))), LTRIM(RTRIM(ISNULL(c.ClanTag, N'')));
  `);
}

export function fetchClub(db: Queries, clubId: number): Promise<ClubRecord | undefined> {
  return db.row<ClubRecord>(sql`
    SELECT c.ID AS club_id, c.ClanTag AS tag, c.ClubName AS name, c.JoinConditions AS join_conditions,
      c.IsOpen AS is_open, c.Region AS region, c.Region2 AS region2, c.Region3 AS region3,
      c.ClubCode AS club_code, c.ClubCode2 AS club_code2, c.ClubCode3 AS club_code3, c.Color1 AS color1,
      c.Color2 AS color2, c.Stadium AS stadium, c.DiscordServer AS discord_server, c.Logo AS logo,
      c.Owner AS owner_raw, c.CreatedAtUtc AS created_at, l.Hash AS logo_hash
    FROM dbo.Club c
    LEFT JOIN dbo.ClubLogo l ON l.ClubId = c.ID
    WHERE c.ID = ${clubId};
  `);
}

export function fetchRoster(db: Queries, clubId: number): Promise<RosterRecord[]> {
  return db.rows<RosterRecord>(sql`
    SELECT p.ID AS player_id, p.Name AS name, p.Country AS country, p.DiscordID AS discord_id,
      cr.IsOfficer AS is_officer
    FROM dbo.ClubRoster cr
    INNER JOIN dbo.Player p ON p.ID = cr.Player
    WHERE cr.Club = ${clubId};
  `);
}

/** Every uploaded logo's club id and hash (the logo route's index, uploaded-logos.ts). */
export async function fetchUploadedLogoHashes(db: Queries): Promise<Map<number, string>> {
  const rows = await db.rows<{ clubId: number; hash: string }>(
    sql`SELECT ClubId AS clubId, Hash AS hash FROM dbo.ClubLogo;`,
  );
  return new Map(rows.map((row) => [row.clubId, row.hash]));
}

/** An uploaded logo (dbo.ClubLogo), served by the logo route; undefined when the club has none. */
export function fetchUploadedLogo(db: Queries, clubId: number): Promise<UploadedLogoRecord | undefined> {
  return db.row<UploadedLogoRecord>(sql`
    SELECT ContentType AS contentType, Hash AS hash, Data AS data FROM dbo.ClubLogo WHERE ClubId = ${clubId};
  `);
}
