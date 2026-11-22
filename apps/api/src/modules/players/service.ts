// Player list and profiles from the database.

import { normalizeText } from "@ms/shared/text";
import type { Queries } from "../../db/database.ts";
import { HttpError } from "../../http/errors.ts";
import { normalizeDiscordId } from "../../lib/discord-id.ts";
import type { CatalogTitle } from "../titles/availability.ts";
import {
  buildPlayerProfileFromRecordsets,
  toPlayerListDTO,
  type PlayerListItem,
  type PlayerProfile,
} from "./mappers.ts";
import { fetchPlayerProfileRecordsets, fetchPlayersByDiscordId, fetchPlayersList } from "./repository.ts";

/** The title catalog (titles/repository.ts, cached); without one, profiles show no title. */
export type TitleCatalogSource = () => Promise<readonly CatalogTitle[]>;

const NO_TITLES: TitleCatalogSource = () => Promise.resolve([]);

export async function getPlayersList(db: Queries): Promise<PlayerListItem[]> {
  const rows = await fetchPlayersList(db);
  return rows.map((row) => toPlayerListDTO(row)).filter((row): row is PlayerListItem => row !== null);
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
