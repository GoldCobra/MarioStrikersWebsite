// Player list and profiles from the database.

import { normalizeText } from "@ms/shared/text";
import type { Database } from "../../db/database.ts";
import { HttpError } from "../../http/errors.ts";
import { normalizeDiscordId } from "../../lib/discord-id.ts";
import type { Logger } from "../../lib/logger.ts";
import type { CatalogTitle } from "../titles/availability.ts";
import {
  buildPlayerProfileFromRecordsets,
  toPlayerListDTO,
  type PlayerListItem,
  type PlayerProfile,
} from "./mappers.ts";
import { fetchPlayerProfileRecordsets, fetchPlayersByDiscordId, fetchPlayersList } from "./repository.ts";

const PROFILE_SLOW_LOG_THRESHOLD_MS = 1500;

type PlayerDatabase = Pick<Database, "withPool" | "measurePool">;

/** The title catalog (titles/repository.ts, cached); without one, profiles show no title. */
export type TitleCatalogSource = () => Promise<readonly CatalogTitle[]>;

const NO_TITLES: TitleCatalogSource = () => Promise.resolve([]);

export async function getPlayersList(database: PlayerDatabase): Promise<PlayerListItem[]> {
  const rows = await database.withPool((pool) => fetchPlayersList(pool));
  return rows.map((row) => toPlayerListDTO(row)).filter((row): row is PlayerListItem => row !== null);
}

async function loadProfile(
  database: PlayerDatabase,
  log: Logger,
  playerId: number,
  titles: TitleCatalogSource,
): Promise<PlayerProfile | null> {
  const catalog = await titles();
  return database.measurePool(async (pool, poolMs) => {
    const startedAt = Date.now();
    const batch = await fetchPlayerProfileRecordsets(pool, playerId);
    const profile = buildPlayerProfileFromRecordsets(batch.recordsets, catalog);
    const totalMs = Date.now() - startedAt + poolMs;
    if (totalMs >= PROFILE_SLOW_LOG_THRESHOLD_MS) {
      log.warn(
        { playerId, totalMs, poolMs, dbMs: batch.dbMs, recordsetCounts: batch.recordsets.map((rows) => rows.length) },
        "[players-profile] slow profile load",
      );
    }
    return profile;
  });
}

/** The profile of a player id (already validated as a positive integer); null when there is none. */
export function getPlayerProfile(
  database: PlayerDatabase,
  log: Logger,
  playerId: number,
  titles: TitleCatalogSource = NO_TITLES,
): Promise<PlayerProfile | null> {
  return loadProfile(database, log, playerId, titles);
}

/**
 * The profile linked to a Discord account; null when none is linked.
 * Two linked profiles are a data error the user cannot fix, reported as 409 PLAYER_PROFILE_CONFLICT.
 */
export async function getPlayerProfileByDiscordId(
  database: PlayerDatabase,
  log: Logger,
  discordIdRaw: unknown,
  titles: TitleCatalogSource = NO_TITLES,
): Promise<PlayerProfile | null> {
  const discordId = normalizeDiscordId(discordIdRaw);
  if (!discordId) throw new HttpError(400, "BAD_REQUEST", "Invalid Discord user id.");
  const rows = await database.withPool((pool) => fetchPlayersByDiscordId(pool, discordId));
  const matches = rows.filter((row) => normalizeDiscordId(row.discord_id) === discordId && normalizeText(row.name));
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new HttpError(409, "PLAYER_PROFILE_CONFLICT", "Multiple player profiles match this Discord account.");
  }
  const playerId = Number(matches[0]?.player_id);
  if (!Number.isInteger(playerId) || playerId <= 0) return null;
  const profile = await loadProfile(database, log, playerId, titles);
  if (!profile) throw new HttpError(404, "NOT_FOUND", "Player not found.");
  return profile;
}
