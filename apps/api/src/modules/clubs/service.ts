// MSBL Striker Clubs: the club list with cached logos, and club profiles with their roster.

import { normalizeText } from "@ms/shared/text";
import type { Database } from "../../db/database.ts";
import { DEFAULT_ACTIVITY_WINDOW_DAYS, toActivityIso } from "../../lib/dates.ts";
import { mapLimit } from "../../lib/concurrency.ts";
import { normalizeDiscordId } from "../../lib/discord-id.ts";
import {
  buildRosterRow,
  compactTextList,
  compareRosterRows,
  resolveOpenStatus,
  toMsblClubDTO,
  type ClubListItem,
  type ClubProfile,
  type RosterRow,
} from "./mappers.ts";
import { fetchClub, fetchClubs, fetchRoster } from "./repository.ts";

export interface LogoResolver {
  ensureClubLogo(club: { club_id?: unknown; logo_source?: unknown }): Promise<string>;
}

export interface RosterNameResolver {
  resolveRosterNames<T extends { discord_id: string; discord_name: string }>(rows: T[]): Promise<T[]>;
}

/** Replaces each club's internal logo source with the URL of its cached logo. */
export async function attachClubLogos(rows: ClubListItem[], logoCache: LogoResolver | null): Promise<ClubListItem[]> {
  await mapLimit(rows, 4, async (row) => {
    if (row.logo_source && logoCache) row.logo = await logoCache.ensureClubLogo(row);
    delete row.logo_source;
  });
  return rows;
}

export async function getMsblClubs(
  database: Pick<Database, "withPool">,
  logoCache: LogoResolver | null,
  options: { now?: Date; activityWindowDays?: number } = {},
): Promise<ClubListItem[]> {
  const now = options.now ?? new Date();
  const activityWindowDays = options.activityWindowDays ?? DEFAULT_ACTIVITY_WINDOW_DAYS;
  const rows = await database.withPool((pool) => fetchClubs(pool));
  const clubs = rows
    .map((row) => toMsblClubDTO(row, { now, activityWindowDays }))
    .filter((club): club is ClubListItem => club !== null);
  return attachClubLogos(clubs, logoCache);
}

function rowDiscordId(row: Pick<RosterRow, "discord_id">): string {
  return normalizeDiscordId(row.discord_id) || normalizeText(row.discord_id);
}

/** A club profile by id (already validated); null when the club does not exist. */
export async function getMsblClubProfile(
  database: Pick<Database, "withPool">,
  dependencies: { logoCache: LogoResolver | null; users: RosterNameResolver },
  clubId: number,
): Promise<ClubProfile | null> {
  return database.withPool(async (pool) => {
    const clubRow = await fetchClub(pool, clubId);
    if (!clubRow) return null;

    const ownerDiscordId = normalizeDiscordId(normalizeText(clubRow.owner_raw));
    const rosterRows = (await fetchRoster(pool, clubId)).map((row) => buildRosterRow(row, ownerDiscordId));
    await dependencies.users.resolveRosterNames(rosterRows);
    rosterRows.sort(compareRosterRows);

    const owner = rosterRows.find((row) => row.is_owner);
    const [club] = await attachClubLogos([toMsblClubDTO(clubRow) ?? emptyClub()], dependencies.logoCache);
    if (!club) return null;
    return {
      club: {
        club_id: club.club_id,
        name: club.name,
        tag: club.tag,
        join_conditions: resolveOpenStatus(clubRow.is_open),
        region: club.region,
        club_code: club.club_code,
        regions: compactTextList([club.region, clubRow.region2, clubRow.region3]),
        club_codes: club.is_open ? compactTextList([club.club_code, clubRow.club_code2, clubRow.club_code3]) : [],
        first_uniform: normalizeText(clubRow.color1),
        second_uniform: normalizeText(clubRow.color2),
        stadium: normalizeText(clubRow.stadium),
        discord_server: normalizeText(clubRow.discord_server),
        created_at: toActivityIso(clubRow.created_at),
        logo: club.logo,
        owner_name: normalizeText(owner?.name),
        owner_discord_id: owner ? rowDiscordId(owner) : "",
      },
      roster: rosterRows.map((row) => ({
        player_id: row.player_id,
        name: row.name,
        country: row.country,
        discord_id: rowDiscordId(row),
        discord_name: row.discord_name,
        is_owner: row.is_owner,
        is_officer: row.is_officer,
        role: row.role,
      })),
    };
  });
}

// A club row without tag and name still has a profile; its list DTO would be null.
function emptyClub(): ClubListItem {
  return {
    club_id: null,
    tag: "",
    name: "",
    status: "",
    is_open: false,
    region: "",
    club_code: "",
    club_codes: [],
    regions: [],
    logo: "",
    activity: null,
    is_active: false,
    member_count: 0,
  };
}
