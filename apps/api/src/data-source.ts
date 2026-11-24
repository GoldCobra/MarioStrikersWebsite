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
import { clubNameKey } from "@ms/shared/clubs";
import type { Config } from "./config.ts";
import { adminConfigProblems, isAdminConfigured, isDiscordLoginConfigured } from "./config.ts";
import { createDatabase } from "./db/database.ts";
import { GuildMemberList } from "./integrations/discord/guild-members.ts";
import { DiscordMemberDirectory } from "./integrations/discord/members.ts";
import type { Logger } from "./lib/logger.ts";
import { createSqlAdminAuditStore } from "./modules/admin/audit-repository.ts";
import { AdminGuard, type AdminAccess } from "./modules/admin/guard.ts";
import { createDiscordOAuthClient, type DiscordOAuthClient } from "./modules/auth/discord-oauth.ts";
import { SessionManager } from "./modules/auth/session.ts";
import { createClubLifecycle } from "./modules/clubs/lifecycle.ts";
import { ClubLogoCache, type LogoFile } from "./modules/clubs/logo-cache.ts";
import { createSqlClubStore } from "./modules/clubs/management-repository.ts";
import { createClubManagement, type ClubManagement } from "./modules/clubs/management.ts";
import { clubLogoSource, type ClubProfile } from "./modules/clubs/mappers.ts";
import { fetchUploadedLogo, fetchUploadedLogoHashes } from "./modules/clubs/repository.ts";
import { createUploadedLogos, type UploadedLogo } from "./modules/clubs/uploaded-logos.ts";
import { getMsblClubProfile, getMsblClubs } from "./modules/clubs/service.ts";
import { CommunityEventsCache, fetchCommunityEvents, type EventsPayload } from "./modules/events/service.ts";
import { getLeaderboardRows, type LeaderboardQuery, type LeaderboardRow } from "./modules/leaderboards/service.ts";
import type { PlayerProfile } from "./modules/players/mappers.ts";
import { withListedName } from "./modules/players/server-names.ts";
import { getPlayerProfile, getPlayerProfileByDiscordId, getPlayersList } from "./modules/players/service.ts";
import { createSqlProfileStore } from "./modules/profile/repository.ts";
import { createProfileService, type ProfileService } from "./modules/profile/service.ts";
import { getProfileStatsByDiscordId } from "./modules/profile/stats-repository.ts";
import type { ProfileStats } from "./modules/profile/stats.ts";
import { getCompetitiveSeasonStatus } from "./modules/season/service.ts";
import { createTitleCatalog } from "./modules/titles/repository.ts";
import { createTitleSyncSchedule } from "./modules/titles/service.ts";
import { WiimmfiService, fetchWiimmfiPlayers, type WiimmfiPlayer } from "./modules/wiimmfi/service.ts";

export type { UploadedLogo };

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
  /** MY PROFILE's statistics of the player linked to this Discord account; null when none is linked. */
  getProfileStatsByDiscordId(discordId: string): Promise<ProfileStats | null>;
  /** null when no club has this (validated) id. */
  getClubProfile(clubId: number): Promise<ClubProfile | null>;
  getClubLogoFile(clubIdRaw: unknown): Promise<LogoFile | null>;
  /** A logo the club uploaded (dbo.ClubLogo); it wins over the cached link. Null without one. */
  getUploadedClubLogo(clubId: number): Promise<UploadedLogo | null>;
  getCommunityEvents(): Promise<EventsPayload>;
  getWiimmfiPlayers(): Promise<WiimmfiPlayer[]>;
  /** Absent when Discord login is not configured; auth routes then report it as unavailable. */
  readonly login: { readonly sessions: SessionManager; readonly oauth: DiscordOAuthClient } | null;
  /** Absent unless the admin page is switched on and configured (and the login is); then nobody is an admin. */
  readonly admin: AdminAccess | null;
  /** My Club (docs/adr/0012); absent when Discord login is not configured. */
  readonly clubs: ClubManagement | null;
  start(): void;
  stop(): Promise<void>;
}

export function createLiveDataSource(config: Config, log: Logger): DataSource {
  const database = createDatabase(config.mssql, log);
  const limits = { defaultLimit: config.leaderboardDefaultLimit, maxLimit: config.leaderboardMaxLimit };
  const discordRest = {
    apiBase: config.discord.apiBase,
    botToken: config.discord.botToken,
    fetchTimeoutMs: config.discord.memberFetchTimeoutMs,
  };
  // The server's member list, read at start and every five minutes in the background: the player list (who is
  // listed, by which name), club rosters, the profile editor's names and My Club (invite list, absence, succession)
  // read it without waiting for Discord.
  const memberList = new GuildMemberList({ ...discordRest, guildId: config.discord.guildId, maxAgeMs: 5 * 60 * 1000 });
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
  // Player titles: the catalog for profiles and the editor, and the daily sync that awards new ones.
  const titleCatalog = createTitleCatalog(database);
  const titleSync = createTitleSyncSchedule({
    database,
    log,
    catalog: titleCatalog,
    intervalMs: config.titleSyncIntervalMs,
  });

  const loaders: Record<string, () => Promise<unknown>> = {
    [PLAYERS_LIST_KEY]: async () => {
      const rows = await getPlayersList(database, memberList);
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
    log,
  });

  const login = isDiscordLoginConfigured(config)
    ? {
        sessions: new SessionManager({ ...config.session, now: Date.now }),
        oauth: createDiscordOAuthClient(config.discord),
      }
    : null;

  // The admin page (docs/adr/0011): roles are read with the bot token and trusted for ADMIN_ROLE_CACHE_TTL_MS;
  // a failed lookup is asked again after at most 15 s and counts as "no admin" meanwhile.
  const adminProblems = config.admin.enabled ? adminConfigProblems(config) : [];
  if (adminProblems.length) {
    log.error({ settings: adminProblems }, "[admin] ADMIN_ENABLED is set, but the admin page stays off");
  }
  const admin: AdminAccess | null = isAdminConfigured(config)
    ? {
        settings: {
          roleIds: config.admin.roleIds,
          pathToken: config.admin.pathToken,
        },
        memberList,
        members: new DiscordMemberDirectory({
          ...discordRest,
          guildId: config.discord.guildId,
          cacheTtlMs: config.admin.roleCacheTtlMs,
          failureCacheTtlMs: Math.min(15_000, config.admin.roleCacheTtlMs),
        }),
        audit: createSqlAdminAuditStore(database),
      }
    : null;

  // The signed-in player's own profile; the editor shows the member's current server names from the member list
  // (live only for a member it lacks). A new country or friend code shows in the player list at once.
  const profiles = createProfileService({
    store: createSqlProfileStore(database, titleCatalog),
    memberList,
    members: new DiscordMemberDirectory({
      ...discordRest,
      guildId: config.discord.guildId,
      cacheTtlMs: 60_000,
      failureCacheTtlMs: 15_000,
    }),
    onChange: () => {
      publicData.refresh(PLAYERS_LIST_KEY).catch((err: unknown) => {
        log.warn({ err }, "[profile] Player list refresh after a profile change failed");
      });
    },
  });

  const uploadedLogos = createUploadedLogos(
    {
      hashes: () => fetchUploadedLogoHashes(database),
      logo: (clubId) => fetchUploadedLogo(database, clubId),
    },
    { log },
  );
  // My Club (docs/adr/0012): the club list and the player list show a club change at once, the logo route too.
  const refreshClubLists = (): void => {
    uploadedLogos.invalidate();
    for (const key of [MSBL_CLUBS_KEY, PLAYERS_LIST_KEY]) {
      publicData.refresh(key).catch((err: unknown) => {
        log.warn({ err, key }, "[clubs] List refresh after a club change failed");
      });
    }
  };
  const clubStore = createSqlClubStore(database, clubNameKey);
  const adminGuard = admin && login ? new AdminGuard(admin, login.sessions, Date.now) : null;
  const clubs = login
    ? createClubManagement({
        store: clubStore,
        members: new DiscordMemberDirectory({
          ...discordRest,
          guildId: config.discord.guildId,
          cacheTtlMs: 60_000,
          failureCacheTtlMs: 15_000,
        }),
        memberList,
        ensurePlayer: (identity) => profiles.ensurePlayer(identity),
        isAdmin: async (cookie) => (adminGuard ? (await adminGuard.check(cookie)).ok : false),
        adminRoleIds: config.admin.roleIds,
        logoUrl: (club) =>
          logos.ensureClubLogo({
            club_id: club.clubId,
            logo_source: clubLogoSource(club.tag, club.name, club.logoUrl),
          }),
        onChange: refreshClubLists,
      })
    : null;
  const clubLifecycle = createClubLifecycle({
    store: clubStore,
    memberList,
    log,
    intervalMs: config.clubs.lifecycleIntervalMs,
    onChange: refreshClubLists,
  });

  return {
    source: "mssql",
    now: Date.now,
    healthCheck: () => database.ping(),
    publicData,
    getLeaderboardRows: (query) => getLeaderboardRows(database, query, limits),
    // The popup goes by the player list's name (docs/adr/0015) as the list is in memory. It never waits for the list,
    // so Discord never holds up a profile: until the first read after a start it keeps the stored name.
    getPlayerProfile: async (playerId) => {
      const profile = await getPlayerProfile(database, playerId, () => titleCatalog.get());
      return profile && withListedName(profile, publicData.peek(PLAYERS_LIST_KEY));
    },
    getPlayerProfileByDiscordId: (discordId) =>
      getPlayerProfileByDiscordId(database, discordId, () => titleCatalog.get()),
    getProfileStatsByDiscordId: (discordId) => getProfileStatsByDiscordId(database, discordId),
    profiles,
    getClubProfile: (clubId) => getMsblClubProfile(database, { logoCache: logos, memberList }, clubId),
    getClubLogoFile: (clubIdRaw) => logos.getLogoFile(clubIdRaw),
    getUploadedClubLogo: (clubId) => uploadedLogos.get(clubId),
    getCommunityEvents: () => events.get(),
    getWiimmfiPlayers: () => wiimmfi.getPlayers(),
    login,
    admin,
    clubs,
    start() {
      memberList.start();
      publicData.start();
      events.start();
      titleSync.start();
      clubLifecycle.start();
    },
    async stop() {
      clubLifecycle.stop();
      titleSync.stop();
      memberList.stop();
      publicData.stop();
      await events.stop();
      await database.close();
    },
  };
}
