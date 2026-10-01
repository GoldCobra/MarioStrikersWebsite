// Everything the routes read comes from a DataSource: the live one below (MSSQL, Discord, FlareSolverr)
// or the invented fixtures of local development and tests (fixtures/data-source.ts).

import {
  COMPETITIVE_SEASON_KEY,
  MSBL_CLUBS_KEY,
  PLAYERS_LIST_KEY,
  PUBLIC_LEADERBOARD_LIMIT,
  PUBLIC_LEADERBOARD_VARIANTS,
  leaderboardCacheKey,
} from "./cache/public-data-keys.ts";
import { PublicDataCache, type PublicDataSource } from "./cache/public-data-cache.ts";
import type { Config } from "./config.ts";
import { isDiscordLoginConfigured } from "./config.ts";
import { Database } from "./db/database.ts";
import { DiscordMemberDirectory } from "./integrations/discord/members.ts";
import { DiscordUserDirectory } from "./integrations/discord/users.ts";
import type { Logger } from "./lib/logger.ts";
import { createDiscordOAuthClient, type DiscordOAuthClient } from "./modules/auth/discord-oauth.ts";
import { SessionManager } from "./modules/auth/session.ts";
import { ClubLogoCache, type LogoFile } from "./modules/clubs/logo-cache.ts";
import type { ClubProfile } from "./modules/clubs/mappers.ts";
import { getMsblClubProfile, getMsblClubs } from "./modules/clubs/service.ts";
import { CommunityEventsCache, fetchCommunityEvents, type EventsPayload } from "./modules/events/service.ts";
import { getLeaderboardRows, type LeaderboardQuery, type LeaderboardRow } from "./modules/leaderboards/service.ts";
import type { PlayerProfile } from "./modules/players/mappers.ts";
import { getPlayerProfile, getPlayerProfileByDiscordId, getPlayersList } from "./modules/players/service.ts";
import { createSqlProfileStore } from "./modules/profile/repository.ts";
import { createProfileService, type ProfileService } from "./modules/profile/service.ts";
import { getCompetitiveSeasonStatus } from "./modules/season/service.ts";
import { WiimmfiService, fetchWiimmfiPlayers, type WiimmfiPlayer } from "./modules/wiimmfi/service.ts";

export interface DataSource {
  /** Reported by /api/health; deploy checks require "mssql" in production. */
  readonly source: "mssql" | "fixtures";
  /** The clock of season responses; fixtures pin it. */
  now(): number;
  healthCheck(): Promise<void>;
  readonly publicData: PublicDataSource;
  getLeaderboardRows(query: LeaderboardQuery): Promise<LeaderboardRow[]>;
  /** null when no player has this (validated) id. */
  getPlayerProfile(playerId: number): Promise<PlayerProfile | null>;
  /** null when no player is linked to this Discord account. */
  getPlayerProfileByDiscordId(discordId: string): Promise<PlayerProfile | null>;
  /** The signed-in player's own profile: created at the first login, changed in the profile editor. */
  readonly profiles: ProfileService;
  /** null when no club has this (validated) id. */
  getClubProfile(clubId: number): Promise<ClubProfile | null>;
  getClubLogoFile(clubIdRaw: unknown): Promise<LogoFile | null>;
  getCommunityEvents(): Promise<EventsPayload>;
  getWiimmfiPlayers(): Promise<WiimmfiPlayer[]>;
  /** Absent when Discord login is not configured; auth routes then report it as unavailable. */
  readonly login: { readonly sessions: SessionManager; readonly oauth: DiscordOAuthClient } | null;
  start(): void;
  stop(): Promise<void>;
}

export function createLiveDataSource(config: Config, log: Logger): DataSource {
  const database = new Database(config.mssql, log);
  const limits = { defaultLimit: config.leaderboardDefaultLimit, maxLimit: config.leaderboardMaxLimit };
  const discordRest = {
    apiBase: config.discord.apiBase,
    botToken: config.discord.botToken,
    fetchTimeoutMs: config.discord.memberFetchTimeoutMs,
  };
  const users = new DiscordUserDirectory({
    ...discordRest,
    guildId: config.discord.guildId,
    cacheTtlMs: config.discord.memberCacheTtlMs,
    failureCacheTtlMs: config.discord.memberFailureCacheTtlMs,
    parallelism: config.discord.memberFetchParallelism,
  });
  const logos = new ClubLogoCache({
    cacheDir: config.clubLogos.cachePath,
    maxBytes: config.clubLogos.maxBytes,
    fetchTimeoutMs: config.clubLogos.fetchTimeoutMs,
    failureRetryMs: config.clubLogos.failureRetryMs,
    log,
  });
  const events = new CommunityEventsCache({
    refreshIntervalMs: config.discord.eventsRefreshIntervalMs,
    log,
    loader: () =>
      fetchCommunityEvents({
        ...discordRest,
        guildId: config.discord.guildId,
        categoryId: config.discord.eventsCategoryId,
      }),
  });
  // FlareSolverr itself waits up to 60 s for Cloudflare; the request gets a little longer.
  const wiimmfi = new WiimmfiService({ log, load: () => fetchWiimmfiPlayers(config.flareSolverrUrl, 70_000) });

  const loaders: Record<string, () => Promise<unknown>> = {
    [PLAYERS_LIST_KEY]: async () => {
      const rows = await getPlayersList(database);
      return { count: rows.length, rows };
    },
    [MSBL_CLUBS_KEY]: async () => {
      const rows = await getMsblClubs(database, logos);
      return { game: "msbl", count: rows.length, rows };
    },
    [COMPETITIVE_SEASON_KEY]: () => getCompetitiveSeasonStatus(database),
  };
  for (const { game, mode } of PUBLIC_LEADERBOARD_VARIANTS) {
    loaders[leaderboardCacheKey(game, mode)] = async () => {
      const rows = await getLeaderboardRows(
        database,
        { gameCode: game, modeCode: mode, limit: PUBLIC_LEADERBOARD_LIMIT, offset: 0 },
        limits,
      );
      return { game, mode, count: rows.length, rows };
    };
  }
  const publicData = new PublicDataCache({
    loaders,
    ttlMs: config.publicDataCache.ttlMs,
    refreshIntervalMs: config.publicDataCache.refreshIntervalMs,
    parallelism: config.publicDataCache.parallelism,
    snapshotPath: config.publicDataCache.snapshotPath,
    log,
  });

  const login = isDiscordLoginConfigured(config)
    ? {
        sessions: new SessionManager({ ...config.session, now: Date.now }),
        oauth: createDiscordOAuthClient(config.discord),
      }
    : null;

  return {
    source: "mssql",
    now: Date.now,
    healthCheck: () => database.healthCheck(),
    publicData,
    getLeaderboardRows: (query) => getLeaderboardRows(database, query, limits),
    getPlayerProfile: (playerId) => getPlayerProfile(database, log, playerId),
    getPlayerProfileByDiscordId: (discordId) => getPlayerProfileByDiscordId(database, log, discordId),
    profiles: createProfileService({
      store: createSqlProfileStore(database),
      // The editor shows the member's current server names; they are asked again after a minute.
      members: new DiscordMemberDirectory({
        ...discordRest,
        guildId: config.discord.guildId,
        cacheTtlMs: 60_000,
        failureCacheTtlMs: 15_000,
      }),
      // A new country or friend code shows in the player list at once, not after the next refresh.
      onChange: () => {
        publicData.refresh(PLAYERS_LIST_KEY).catch((err: unknown) => {
          log.warn({ err }, "[profile] Player list refresh after a profile change failed");
        });
      },
    }),
    getClubProfile: (clubId) => getMsblClubProfile(database, { logoCache: logos, users }, clubId),
    getClubLogoFile: (clubIdRaw) => logos.getLogoFile(clubIdRaw),
    getCommunityEvents: () => events.get(),
    getWiimmfiPlayers: () => wiimmfi.getPlayers(),
    login,
    start() {
      database.startKeepalive();
      publicData.start();
      events.start();
    },
    async stop() {
      await publicData.stop();
      await events.stop();
      await database.close();
    },
  };
}
