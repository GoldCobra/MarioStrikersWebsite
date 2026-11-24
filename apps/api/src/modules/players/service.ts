// Player list and profiles from the database; the list's players and names from the server's member list.

import { normalizeCountryCode } from "@ms/shared/countries";
import { normalizeText } from "@ms/shared/text";
import type { Queries } from "../../db/database.ts";
import { HttpError } from "../../http/errors.ts";
import type { GuildMemberSnapshot } from "../../integrations/discord/guild-members.ts";
import { isActivityActive, toActivityIso } from "../../lib/dates.ts";
import { normalizeDiscordId } from "../../lib/discord-id.ts";
import type { CatalogTitle } from "../titles/availability.ts";
import { buildPlayerProfileFromRecordsets, type PlayerProfile } from "./mappers.ts";
import { fetchPlayerListSource, fetchPlayerProfileRecordsets, fetchPlayersByDiscordId } from "./repository.ts";
import { buildPlayerList, clubTagList, type PlayerListRow } from "./server-names.ts";

/** The title catalog (titles/repository.ts, cached); without one, profiles show no title. */
export type TitleCatalogSource = () => Promise<readonly CatalogTitle[]>;

const NO_TITLES: TitleCatalogSource = () => Promise.resolve([]);

/**
 * The player list (docs/adr/0015): every profile whose Discord account is on the server now, by server name. It is
 * never built without the member list: a list that cannot tell who is on the server would show those who left.
 */
export async function getPlayersList(
  db: Queries,
  memberList: { get(): Promise<GuildMemberSnapshot | null> },
  options: { now?: Date; activityWindowDays?: number } = {},
): Promise<PlayerListRow[]> {
  const [source, snapshot] = await Promise.all([fetchPlayerListSource(db), memberList.get()]);
  if (!snapshot) {
    throw new HttpError(503, "UPSTREAM_UNAVAILABLE", "The player list is not available right now.");
  }
  const profiles = source.profiles.map((row) => ({
    playerId: row.player_id,
    discordId: normalizeText(row.discord_id),
    country: normalizeCountryCode(row.country),
    activity: toActivityIso(row.activity),
    isActive: isActivityActive(row.activity, options.now, options.activityWindowDays),
  }));
  return buildPlayerList(profiles, snapshot.members, clubTagList(source.clubTags));
}

async function loadProfile(db: Queries, playerId: number, titles: TitleCatalogSource): Promise<PlayerProfile | null> {
  const catalog = await titles();
  return buildPlayerProfileFromRecordsets(await fetchPlayerProfileRecordsets(db, playerId), catalog);
}

/** The profile of a player id (already validated as a positive integer); null when there is none. */
export function getPlayerProfile(
  db: Queries,
  playerId: number,
  titles: TitleCatalogSource = NO_TITLES,
): Promise<PlayerProfile | null> {
  return loadProfile(db, playerId, titles);
}

/**
 * The id of the player linked to a Discord account; null when none is linked. Two linked profiles are a
 * data error the user cannot fix, reported as 409 PLAYER_PROFILE_CONFLICT.
 */
export async function findLinkedPlayerId(db: Queries, discordIdRaw: unknown): Promise<number | null> {
  const discordId = normalizeDiscordId(discordIdRaw);
  if (!discordId) throw new HttpError(400, "BAD_REQUEST", "Invalid Discord user id.");
  const rows = await fetchPlayersByDiscordId(db, discordId);
  const matches = rows.filter((row) => normalizeDiscordId(row.discord_id) === discordId && normalizeText(row.name));
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new HttpError(409, "PLAYER_PROFILE_CONFLICT", "Multiple player profiles match this Discord account.");
  }
  const playerId = Number(matches[0]?.player_id);
  return Number.isInteger(playerId) && playerId > 0 ? playerId : null;
}

/**
 * The profile linked to a Discord account; null when none is linked.
 * Two linked profiles are a data error the user cannot fix, reported as 409 PLAYER_PROFILE_CONFLICT.
 */
export async function getPlayerProfileByDiscordId(
  db: Queries,
  discordIdRaw: unknown,
  titles: TitleCatalogSource = NO_TITLES,
): Promise<PlayerProfile | null> {
  const playerId = await findLinkedPlayerId(db, discordIdRaw);
  if (playerId === null) return null;
  const profile = await loadProfile(db, playerId, titles);
  if (!profile) throw new HttpError(404, "NOT_FOUND", "Player not found.");
  return profile;
}
