// Entirely invented development data. Never copy a production snapshot into this module.
// Shapes mirror the live API exactly so fixture pages render like production pages.
// Set MSC_FIXTURE_NOW (ISO date) to make every timestamp deterministic, e.g. for the comparison checks.

import crypto from "node:crypto";
import path from "node:path";
import { COMPETITIVE_SEASON_KEY, MSBL_CLUBS_KEY, PLAYERS_LIST_KEY } from "../cache/public-data-keys.ts";
import type { CacheResult } from "../cache/public-data-cache.ts";
import type { DataSource } from "../data-source.ts";
import type { DiscordLogin, DiscordOAuthClient } from "../modules/auth/discord-oauth.ts";
import { SessionManager } from "../modules/auth/session.ts";
import type { ClubListItem, ClubProfile, RosterRow } from "../modules/clubs/mappers.ts";
import type { EventsPayload } from "../modules/events/service.ts";
import { assertGameAndMode, parseLimit, parseOffset, type GameCode } from "../modules/leaderboards/params.ts";
import type { LeaderboardRow } from "../modules/leaderboards/service.ts";
import { normalizeCountryCode } from "@ms/shared/countries";
import { toText } from "@ms/shared/text";
import { UNKNOWN_MEMBER, type GuildMemberLookup } from "../integrations/discord/members.ts";
import type { PlayerListItem, PlayerProfile, RatingBlock, SeasonRewardLevelDto } from "../modules/players/mappers.ts";
import {
  applyPlan,
  createProfileService,
  type CountryOption,
  type ProfileStore,
  type StoredFriendCode,
  type StoredProfile,
} from "../modules/profile/service.ts";
import {
  availableTitles,
  selectedTitle,
  titleLook,
  titleText,
  toTitleOption,
  type CatalogTitle,
} from "../modules/titles/availability.ts";
import { buildProfileStats, type ProfileStats } from "../modules/profile/stats.ts";
import { TITLE_CATEGORIES, TITLE_CATEGORY, seededCatalog } from "../modules/titles/catalog.ts";

const DAY_MS = 86_400_000;
const ASSET_VERSION = "20260608-rank-crop-v1";
const RANK_NAMES = [
  "Unranked",
  "Bronze I",
  "Bronze II",
  "Bronze III",
  "Silver I",
  "Silver II",
  "Silver III",
  "Gold I",
  "Gold II",
  "Gold III",
  "Platinum I",
  "Platinum II",
  "Platinum III",
  "Diamond I",
  "Diamond II",
  "Diamond III",
  "Master I",
  "Master II",
  "Master III",
  "Strikers Titan",
];
const RANK_ICON_FILES = [
  "",
  "1-bronze-I.png",
  "1-bronze-II.png",
  "1-bronze-III.png",
  "2-silver-I.png",
  "2-silver-II.png",
  "2-silver-III.png",
  "3-gold-I.png",
  "3-gold-II.png",
  "3-gold-III.png",
  "4-platinum-I.png",
  "4-platinum-II.png",
  "4-platinum-III.png",
  "5-diamond-I.png",
  "5-diamond-II.png",
  "5-diamond-III.png",
  "6-master-I.png",
  "6-master-II.png",
  "6-master-III.png",
  "7-strikerstitan-b.png",
];
const REWARD_LEVELS: readonly (readonly [string, string])[] = [
  ["Unranked", "0-unranked.png"],
  ["Bronze", "1-bronze.png"],
  ["Silver", "2-silver.png"],
  ["Gold", "3-gold.png"],
  ["Platinum", "4-platinum.png"],
  ["Diamond", "5-diamond.png"],
  ["Master", "6-master.png"],
  ["Strikers Titan", "7-strikerstitan-b.png"],
];
const PLAYER_NAMES = [
  "Sample Player",
  "Practice Partner",
  "Training Rookie",
  "Pixel Piranha",
  "Turbo Shell",
  "Banana Drift",
  "Chain Chomper",
  "Mega Striker",
  "Hyper Volley",
  "Koopa Kicker",
  "Lakitu Loop",
  "Cloud Keeper",
  "Zoë Ñandú",
  "Captain Incredibly Long Sample Name",
  "dotted.sample",
  "<i>Escaped Name</i>",
  "Player 42",
  "Rocket Toad",
  "Midfield Mushroom",
  "Goalie Gumba",
  "Thunder Boot",
  "Crystal Cleat",
  "Lava Lob",
  "Sand Tomb Sam",
  "Stormship Sky",
  "Galactic Goal",
  "Vice Versa",
  "Dump Truck Dan",
  "Wasteland Will",
  "Classroom Kid",
  "Sudden Death",
  "Results Rita",
  "Credits Carl",
  "Pause Menu",
  "Loading Lou",
  "Header Hank",
  "Volley Vera",
  "Bicycle Ben",
  "Nutmeg Nora",
  "Penalty Pete",
  "Offside Olly",
  "Corner Cora",
  "Free Kick Finn",
  "Throw-in Theo",
  "Extra Time Eve",
  "Golden Goal Gus",
  "Hat-trick Hal",
  "Last Minute Lin",
];
const COUNTRIES = [
  "de",
  "us",
  "gb",
  "gb-eng",
  "gb-sct",
  "gb-wls",
  "fr",
  "it",
  "es",
  "nl",
  "se",
  "jp",
  "kr",
  "br",
  "mx",
  "ca",
  "au",
  "ch",
  "pt",
  "",
  "ve",
  "be",
  "at",
  "no",
];
// The profile editor's countries, shaped like dbo.Enumeration's (home nations and the rows that are no
// country included, so the editor's filtering shows).
const COUNTRY_OPTIONS: readonly CountryOption[] = [
  ["at", "Austria"],
  ["au", "Australia"],
  ["be", "Belgium"],
  ["br", "Brazil"],
  ["ca", "Canada"],
  ["ch", "Switzerland"],
  ["de", "Germany"],
  ["england", "England"],
  ["es", "Spain"],
  ["eu", "Europe is NOT a Country"],
  ["fr", "France"],
  ["gb", "United Kingdom"],
  ["it", "Italy"],
  ["jp", "Japan"],
  ["kr", "South Korea"],
  ["mx", "Mexico"],
  ["nl", "Netherlands"],
  ["no", "Norway"],
  ["northern_ireland", "Northern Ireland"],
  ["pt", "Portugal"],
  ["rocci", "Arg Matey!"],
  ["scotland", "Scotland"],
  ["se", "Sweden"],
  ["us", "United States"],
  ["ve", "Venezuela"],
  ["wales", "Wales"],
  ["xk", "Kosovo"],
].map(([code = "", name = ""]) => ({ code, name }));
const CLUB_DEFS: readonly (readonly [string, string, string, string, readonly string[]])[] = [
  ["Sample Strikers", "SMP", "Open to Anyone", "EU", ["EU"]],
  ["Demo United", "DEMO", "Invite Only", "NA", ["NA"]],
  ["Fixture FC", "FIX", "Open to Anyone", "NA", ["NA", "EU", "SA"]],
  ["Placeholder Athletic", "PLH", "Invite Only", "EU", ["EU"]],
  ["Mock Mushrooms", "MOCK", "Open to Anyone", "JP", ["JP"]],
  ["Synthetic Shells", "SYN", "Closed", "OCE", ["OCE"]],
  ["Test Toads", "TST", "Open to Anyone", "SA", ["SA", "NA"]],
  ["Example Eagles", "EXE", "Invite Only", "EU", ["EU", "NA"]],
  ["Dummy Dynamos", "DUM", "Open to Anyone", "NA", ["NA"]],
  ["Lorem Ipsum Legends Football Club", "LIL", "Open to Anyone", "EU", ["EU"]],
  ["Stub Stars", "STB", "Invite Only", "NA", ["NA"]],
  ["No Logo Club", "NLC", "Open to Anyone", "EU", ["EU"]],
];
const TOURNAMENTS: readonly (readonly [string, string, boolean])[] = [
  ["MSL 2025 World Championship", "🥇", true],
  ["MSL 2026 Spring Series", "🥇", false],
  ["MSL 2025 Fall Series - Premier", "🥈", false],
  ["Sample Training Cup", "🥉", false],
  ["Community Weekly #12", "🥇", false],
  ["Demo Doubles Open", "🥈", false],
];
const GAMES: readonly GameCode[] = ["msbl", "msc", "sms"];
// Player titles: the real catalog plus one season title and two MSL event variants (as the sync creates them
// when a season ends with a Strikers Titan or an MSL event has a winner), with invented unlocks. Player 1 (the
// signed-in sample, a world champion like its accolades say) has a title of every look, of every game, but
// none selected; player 2 (a world champion too) shows the longest free title, player 5 (no champion) an
// unlocked one.
const FIXTURE_SEASON_TITLE = {
  code: "season-titan-1-msbl",
  name: "BURST 2026 STRIKERS TITAN",
  seasonNumber: 1,
  gameCode: "MSBL",
} as const;
const FIXTURE_MSL_VARIANTS = [
  { template: "msl-2025-world-champion", gameCode: "MSBL", suffix: "msbl" },
  { template: "msl-2026-spring-champion", gameCode: "SMS", suffix: "sms" },
] as const;
const FIXTURE_TITLE_UNLOCKS: Readonly<Record<number, readonly string[]>> = {
  1: [
    "msl-2025-world-champion-msbl",
    "msl-2-time-world-champion-msbl",
    "msl-2026-spring-champion-sms",
    FIXTURE_SEASON_TITLE.code,
    "tournament-winner-msc",
    "tournament-winner-green-msc",
    "wfc-final-season-leader",
    "legacy-megastriker",
  ],
  2: ["tournament-winner-sms", "legacy-legend"],
  3: ["legacy-rookie"],
  5: ["legacy-superstar"],
};
const FIXTURE_SELECTED_TITLES: Readonly<Record<number, string>> = {
  2: "self-proclaimed-king-of-strikers",
  5: "legacy-superstar",
};

interface RatingEntry {
  readonly player: PlayerListItem & { player_id: number };
  readonly elo: number | null;
  readonly whr: number | null;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly played: boolean;
}

function resolveFixtureNow(value: string | undefined): { now: number; pinned: boolean } {
  if (!value) return { now: Date.now(), pinned: false };
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Invalid MSC_FIXTURE_NOW; use an ISO date.");
  return { now: parsed, pinned: true };
}

// Small deterministic PRNG (mulberry32) so the invented data is identical on every start.
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const versioned = (url: string): string => `${url}?v=${ASSET_VERSION}`;

function rankIconUrl(rankNumber: number): string {
  return rankNumber > 0
    ? versioned(`/assets/leaderboards/rankicons/${RANK_ICON_FILES[rankNumber] ?? ""}`)
    : versioned("/assets/players/rewardlevel/0-unranked.png");
}

function rewardLevel(
  order: number,
  extra: { current_wins?: number; required_wins?: number } = {},
): SeasonRewardLevelDto {
  const [name, image] = REWARD_LEVELS[order] ?? ["Unranked", "0-unranked.png"];
  return { order, name, image_url: versioned(`/assets/players/rewardlevel/${image}`), ...extra };
}

function rankNumberForRating(rating: number): number {
  if (rating >= 1750) return 19;
  return Math.max(1, Math.min(18, Math.floor((rating - 400) / 75) + 1));
}

function fakeFriendCode(random: () => number, prefix?: string): string {
  const block = (): string => String(Math.floor(random() * 10000)).padStart(4, "0");
  return `${prefix ? `${prefix}-` : ""}${block()}-${block()}-${block()}`;
}

/**
 * MY PROFILE's statistics of the signed-in sample member, as the database's result sets would hold them
 * (modules/profile/stats.ts reads them the same way): MSBL with every value, MSC without a match in the
 * current season, SMS with real zeros only (a pre-made 0-0 season row and a 0-0 record, no WHR, no legacy
 * rank). A profile created at login has no data at all.
 */
function sampleProfileStats(): ProfileStats {
  const rank = (rankNumber: number) => ({ RankNumber: rankNumber, RankName: RANK_NAMES[rankNumber] ?? "" });
  return buildProfileStats([
    [{ Id: 3, DisplayName: "Dusk Season 2026" }],
    [
      { GameId: 3, Elo: 1187.42, MatchWins: 14, MatchLosses: 6, ...rank(9) },
      { GameId: 2, Elo: 500, MatchWins: 0, MatchLosses: 0, ...rank(0) },
    ],
    [
      { GameId: 3, ...rank(11) },
      { GameId: 1, ...rank(7) },
      { GameId: 2, ...rank(0) },
    ],
    [
      { GameType: 3, Whr: 1612, MatchWins: 212, MatchLosses: 131 },
      { GameType: 1, Whr: 1404, MatchWins: 88, MatchLosses: 90 },
      { GameType: 2, Whr: null, MatchWins: 0, MatchLosses: 0 },
    ],
    [
      { GameType: 3, MaxWhr: 1688, Days: 120 },
      { GameType: 1, MaxWhr: 1530, Days: 64 },
    ],
    [
      { GameType: 3, Rank: 13, Rank2v2: 0, Singles: 64, Teams: 0 },
      { GameType: 1, Rank: 8, Rank2v2: 5, Singles: 25, Teams: 2 },
    ],
  ]);
}

export interface FixtureOptions {
  /** MSC_FIXTURE_NOW: pins every timestamp and the session clock. */
  readonly fixedNow?: string;
}

export function createFixtureDataSource(options: FixtureOptions = {}): DataSource {
  const clock = resolveFixtureNow(options.fixedNow);
  const now = clock.now;
  const nowFn = (): number => (clock.pinned ? now : Date.now());
  const generatedAt = new Date(now).toISOString();
  const random = createRandom(20260927);
  const iso = (offsetMs: number): string => new Date(now + offsetMs).toISOString();

  const linkedUser = { id: "900000000000000001", username: "sample_player", global_name: "Sample Player", avatar: "" };
  const unlinkedUser = {
    id: "900000000000000002",
    username: "unlinked_sample",
    global_name: "Unlinked Sample",
    avatar: "",
  };
  const loginsByCode: Readonly<Record<string, DiscordLogin>> = {
    sample: { user: linkedUser, nick: "[SMP] Sample Player" },
    "sample-unlinked": { user: unlinkedUser, nick: "" },
  };

  const clubs: ClubListItem[] = CLUB_DEFS.map(([name, tag, status, region, regions], index) => {
    const clubId = index + 1;
    const hasLogo = tag !== "NLC";
    const codes =
      index % 3 === 2
        ? []
        : [String(1000000 + clubId * 7919).slice(0, 7), ...(index % 4 === 0 ? [`ABC${clubId}DEF`] : [])];
    return {
      club_id: clubId,
      tag,
      name,
      status,
      is_open: status === "Open to Anyone",
      region,
      club_code: codes[0] ?? "",
      club_codes: codes,
      regions: [...regions],
      logo: hasLogo ? `/api/clubs/msbl/${clubId}/logo?v=synthetic${clubId}` : "",
      activity: iso(-(index * 9 + 1) * DAY_MS),
      is_active: index % 5 !== 4,
      member_count: 0,
    };
  });

  const players = PLAYER_NAMES.map((name, index) => {
    const playerId = index + 1;
    const club = index % 2 === 0 || index < 4 ? clubs[index % clubs.length] : undefined;
    const daysAgo = index % 7 === 6 ? null : index * 3;
    const activity = daysAgo === null ? null : iso(-daysAgo * DAY_MS - 3600000);
    return {
      player_id: playerId,
      name,
      display_name: name,
      country: COUNTRIES[index % COUNTRIES.length] ?? "",
      club_id: club ? club.club_id : null,
      club_name: club ? club.name : null,
      club_tag: club ? club.tag : null,
      activity,
      is_active: daysAgo !== null && daysAgo <= 90,
    };
  });
  for (const club of clubs) club.member_count = players.filter((player) => player.club_id === club.club_id).length;

  const discordIdFor = (player: { player_id: number }): string | null => {
    if (player.player_id === 1) return linkedUser.id;
    return player.player_id % 3 === 0 ? `9100000000000000${String(player.player_id).padStart(2, "0")}` : null;
  };

  // Ratings per game are derived once so leaderboards and profiles agree.
  const ratingsByGame = {} as Record<GameCode, RatingEntry[]>;
  GAMES.forEach((game, gameIndex) => {
    ratingsByGame[game] = players.map((player, index) => {
      const played = game === "msbl" || (index + gameIndex) % 3 !== 0;
      const elo = played ? Math.round(1880 - index * 29 - gameIndex * 17 + random() * 12) : null;
      const whr = played ? Math.round(2150 - index * 23 - gameIndex * 31 + random() * 9) : null;
      const wins = played ? 3 + Math.floor(random() * 60) : 0;
      const losses = played ? Math.floor(random() * 40) : 0;
      return {
        player: player as RatingEntry["player"],
        elo,
        whr,
        wins,
        losses,
        draws: index % 11 === 0 && played ? 1 : 0,
        played,
      };
    });
  });

  function competitiveRows(game: GameCode, mode: string): LeaderboardRow[] {
    const source = ratingsByGame[game].filter((entry) => entry.played);
    const limitCount = mode === "elo2v2" ? 8 : game === "msbl" ? source.length : 18;
    const rows = source.slice(0, limitCount).map((entry, index) => ({
      player: entry.player,
      rating: mode === "elo2v2" ? Math.round((entry.elo ?? 0) * 0.72) : (entry.elo ?? 0),
      wins: mode === "elo2v2" ? 2 + (index % 5) : entry.wins,
      losses: mode === "elo2v2" ? index % 3 : entry.losses,
      draws: mode === "elo2v2" ? 0 : entry.draws,
    }));
    rows.sort((a, b) => b.rating - a.rating);
    return rows.map((row, index) => ({
      rank: index + 1,
      player_id: row.player.player_id,
      discord_user_id: discordIdFor(row.player),
      display_name: row.player.display_name,
      total_matches: row.wins + row.losses + row.draws,
      total_wins: row.wins,
      total_losses: row.losses,
      total_draws: row.draws,
      total_game_diff: 0,
      total_goals_for: 0,
      total_goals_against: 0,
      total_goal_diff: 0,
      rating: row.rating,
      competitive_rank: RANK_NAMES[rankNumberForRating(row.rating)] ?? "",
      updated_at: iso(-(index + 1) * 60000),
    }));
  }

  function whrRows(game: GameCode): LeaderboardRow[] {
    const ball = { msbl: "blball", msc: "mscball", sms: "smsball" }[game];
    const rows = ratingsByGame[game]
      .filter((entry) => entry.played)
      .slice(0, 26)
      .map((entry, index) => {
        // A few WHR names have no matching Player row in the live data; mirror that.
        const unmatched = index % 9 === 8;
        return {
          player_id: unmatched ? null : entry.player.player_id,
          discord_user_id: unmatched ? null : discordIdFor(entry.player),
          display_name: unmatched ? `Unlinked ${entry.player.display_name}` : entry.player.display_name,
          total_matches: entry.wins * 9 + entry.losses * 7,
          total_wins: entry.wins * 9,
          total_losses: entry.losses * 7,
          total_draws: entry.draws,
          rating: entry.whr ?? 0,
          competitive_rank: game === "msc" && index % 4 === 1 ? `${ball}2` : ball,
        };
      });
    rows.sort((a, b) => b.rating - a.rating || a.display_name.localeCompare(b.display_name));
    return rows.map((row, index) => ({
      rank: index + 1,
      player_id: row.player_id,
      discord_user_id: row.discord_user_id,
      display_name: row.display_name,
      total_matches: row.total_matches,
      total_wins: row.total_wins,
      total_losses: row.total_losses,
      total_draws: row.total_draws,
      total_game_diff: 0,
      total_goals_for: 0,
      total_goals_against: 0,
      total_goal_diff: 0,
      rating: row.rating,
      competitive_rank: row.competitive_rank,
      updated_at: generatedAt,
    }));
  }

  const leaderboardRows = (game: GameCode, mode: string): LeaderboardRow[] =>
    mode === "whr" ? whrRows(game) : competitiveRows(game, mode);

  function ratingBlock(game: GameCode, player: RatingEntry["player"]): RatingBlock {
    const index = player.player_id - 1;
    const entry = ratingsByGame[game][index];
    if (!entry) return {};
    if (!entry.played && index % 2 === 0) {
      return {
        rating: null,
        sets: "0-0",
        games: "0-0",
        rank_emoji: "",
        rank_icon_url: "",
        competitive_rank: "",
        competitive_rank_number: null,
        season_reward_level: rewardLevel(0, { current_wins: 0, required_wins: 5 }),
        whr: null,
      };
    }
    const seasonPlayed = index % 5 !== 3;
    const rankNumber = seasonPlayed ? rankNumberForRating(entry.elo ?? 500) : 0;
    const rewardOrder = seasonPlayed ? Math.min(7, Math.floor(index / 2) % 8) : 0;
    return {
      rating: entry.elo,
      sets: seasonPlayed ? `${entry.wins % 12}-${entry.losses % 7}` : "0-0",
      games: `${entry.wins * 9}-${entry.losses * 7}`,
      rank_emoji: "",
      rank_icon_url: rankIconUrl(rankNumber),
      competitive_rank: RANK_NAMES[rankNumber] ?? "",
      competitive_rank_number: rankNumber,
      season_reward_level: rewardLevel(rewardOrder, {
        current_wins: rewardOrder === 7 ? 5 : index % 6,
        required_wins: 5,
      }),
      whr: entry.whr,
    };
  }

  function buildPlayerProfile(player: RatingEntry["player"]): PlayerProfile {
    const index = player.player_id - 1;
    const accoladeCount = index === 0 ? TOURNAMENTS.length : index % 4;
    const accolades = TOURNAMENTS.slice(0, accoladeCount).map(([tournament, medal, worldChampion], position) => ({
      place_medal: medal,
      game_code: ["MSBL", "MSC", "SMS"][(index + position) % 3] ?? "",
      tournament_name: tournament,
      start_date: iso(-(position + 1) * 60 * DAY_MS).slice(0, 10),
      is_winner: medal === "🥇",
      is_world_champion: worldChampion && medal === "🥇",
    }));
    const seasonAwards =
      index % 3 === 1
        ? []
        : [
            {
              season_name: "Burst 2026",
              game_code: "MSBL",
              mode_code: "1v1",
              award_code: "TOP_10",
              award_name: "Top 10",
              rank_position: (index % 9) + 1,
              metric_label: `${1500 - index * 7}.25 ELO`,
            },
            ...(index % 2 === 0
              ? [
                  {
                    season_name: "Rise 2026",
                    game_code: "MSC",
                    mode_code: "1v1",
                    award_code: "TOP_3",
                    award_name: "Top 3",
                    rank_position: (index % 3) + 1,
                    metric_label: `${1400 - index * 5}.5 ELO`,
                  },
                ]
              : []),
          ];
    const has2v2 = index % 4 === 0;
    return {
      player: {
        id: player.player_id,
        name: player.name,
        country: editedCountry(player.player_id, player.country),
        club_id: player.club_id,
        club_name: player.club_name,
        club_tag: player.club_tag,
        results_url: index % 3 === 0 ? `https://start.gg/user/sample${player.player_id}/results` : "",
        activity: player.activity,
        is_active: player.is_active,
        ...titleFieldsOf(player.player_id),
      },
      friend_codes: editedProfiles.has(player.player_id)
        ? editedFriendCodes(player.player_id)
        : {
            switch: index % 5 === 4 ? [] : [fakeFriendCode(createRandom(player.player_id), "SW")],
            msc: index % 3 === 2 ? [] : [`PAL (Wii): ${fakeFriendCode(createRandom(player.player_id + 100))}`],
            msc_pal: index % 3 === 2 ? [] : [`PAL (Wii): ${fakeFriendCode(createRandom(player.player_id + 100))}`],
            msc_ntsc:
              index % 4 === 1 ? [`NTSC (Dolphin): ${fakeFriendCode(createRandom(player.player_id + 200))}`] : [],
            msc_kor: [],
            msc_jpn: [],
          },
      season_awards: seasonAwards,
      accolades,
      ratings: {
        sms: ratingBlock("sms", player),
        msc: ratingBlock("msc", player),
        msbl: ratingBlock("msbl", player),
        sms2v2: {},
        msc2v2: {},
        msbl2v2: has2v2
          ? {
              ...ratingBlock("msbl", player),
              rating: Math.round((ratingsByGame.msbl[index]?.elo ?? 800) * 0.72),
              tst: 1700 - index * 11,
            }
          : {},
      },
      season_reward_level: rewardLevel(Math.min(7, index % 8)),
      highest_rank_banner_url: "",
    };
  }

  // The selected title of a player as dbo.PlayerActiveTitle would hold it, edited or invented.
  const seededTitles = seededCatalog();
  const titleCatalog: CatalogTitle[] = [
    ...seededTitles,
    ...seededTitles
      .filter((title) => title.code === "legacy-rookie")
      .map((template) => ({
        ...template,
        id: seededTitles.length + 1,
        code: FIXTURE_SEASON_TITLE.code,
        name: FIXTURE_SEASON_TITLE.name,
        category: TITLE_CATEGORY.season,
        categoryName: "Competitive Season Titles",
        categorySort: TITLE_CATEGORIES.find((category) => category.code === TITLE_CATEGORY.season)?.sortOrder ?? 0,
        sortOrder: FIXTURE_SEASON_TITLE.seasonNumber,
        ruleKind: "season-titan",
        ruleParams: JSON.stringify({ season_id: FIXTURE_SEASON_TITLE.seasonNumber }),
        exclusiveGroup: "",
        exclusiveLevel: 0,
        gameCode: FIXTURE_SEASON_TITLE.gameCode,
      })),
    ...FIXTURE_MSL_VARIANTS.flatMap((variant, index) =>
      seededTitles
        .filter((title) => title.code === variant.template)
        .map((template) => ({
          ...template,
          id: seededTitles.length + 2 + index,
          code: `${template.code}-${variant.suffix}`,
          ruleKind: "tournament-name",
          gameCode: variant.gameCode,
        })),
    ),
  ];
  const titleIds = new Map(titleCatalog.map((title) => [title.code, title.id]));
  const unlockedTitleIds = (playerId: number): number[] =>
    (FIXTURE_TITLE_UNLOCKS[playerId] ?? []).map((code) => titleIds.get(code) ?? 0);
  const titleOptionsOf = (playerId: number) =>
    availableTitles(titleCatalog, unlockedTitleIds(playerId), { playerId }).map(toTitleOption);
  function selectedTitleOf(playerId: number) {
    const edited = editedProfiles.get(playerId);
    const code = edited ? edited.title : (FIXTURE_SELECTED_TITLES[playerId] ?? "");
    return selectedTitle(titleCatalog, unlockedTitleIds(playerId), titleIds.get(code) ?? null, { playerId });
  }
  function titleFieldsOf(playerId: number): { title: string; title_style: string; title_game_code: string } {
    const title = selectedTitleOf(playerId);
    return {
      title: title ? titleText(title.name) : "",
      title_style: title ? titleLook(title) : "",
      title_game_code: title?.gameCode ?? "",
    };
  }

  function buildClubProfile(club: ClubListItem): ClubProfile {
    const members = players.filter((player) => player.club_id === club.club_id);
    const roster: RosterRow[] = members.map((player, index) => {
      const role = index === 0 ? "owner" : index === 1 ? "officer" : "member";
      const discordId = discordIdFor(player) ?? "";
      return {
        player_id: player.player_id,
        name: player.name,
        country: player.country,
        discord_id: discordId,
        discord_name: discordId ? player.name.toLowerCase().replace(/[^a-z0-9]+/g, "_") : "",
        is_owner: role === "owner",
        is_officer: role === "officer",
        role,
      };
    });
    const owner = roster[0];
    const clubId = club.club_id ?? 0;
    return {
      club: {
        club_id: club.club_id,
        name: club.name,
        tag: club.tag,
        join_conditions: club.status,
        region: club.region,
        club_code: club.club_code,
        regions: club.regions,
        club_codes: club.club_codes,
        first_uniform: ["Red", "Blue", "Green", "Yellow"][clubId % 4] ?? "",
        second_uniform: ["White", "Black", "Orange", "Purple"][clubId % 4] ?? "",
        stadium: ["Mushroom Hill", "Spooky Mansion", "Desert Ruins", "Pipeline Central"][clubId % 4] ?? "",
        discord_server: clubId % 2 === 0 ? `https://discord.gg/sample${clubId}` : "",
        created_at: iso(-(400 + clubId * 30) * DAY_MS),
        logo: club.logo,
        owner_name: owner?.name ?? "",
        owner_discord_id: owner?.discord_id ?? "",
      },
      roster,
    };
  }

  const findPlayer = (id: number): RatingEntry["player"] | undefined =>
    players.find((row) => row.player_id === id) as RatingEntry["player"] | undefined;
  const findClub = (id: unknown): ClubListItem | undefined => clubs.find((row) => String(row.club_id) === String(id));

  // Discord login is simulated: "sample" logs in the linked player, "sample-unlinked" a Discord user
  // without a profile, who gets a new one like on the live site. The session and state logic is the real one.
  const oauth: DiscordOAuthClient = {
    authorizeUrl: (state) => `/api/auth/discord/callback?code=sample&state=${encodeURIComponent(state)}`,
    completeLogin: (code) => {
      const login = loginsByCode[code];
      return login ? Promise.resolve(login) : Promise.reject(new Error("Invalid sample login code."));
    },
  };

  // Profiles created by simulated logins, by Discord id, and profiles changed in the editor, by player id;
  // both live as long as the process.
  const createdPlayers = new Map<string, { readonly player_id: number; readonly name: string }>();
  const editedProfiles = new Map<number, StoredProfile>();

  /** A player's country, friend codes and title as dbo.Player, dbo.FriendCodes and the title tables would hold them. */
  function storedProfileOf(playerId: number): StoredProfile | null {
    const edited = editedProfiles.get(playerId);
    if (edited) return { ...edited, titles: titleOptionsOf(playerId) };
    if ([...createdPlayers.values()].some((created) => created.player_id === playerId)) {
      return { playerId, country: "", codes: [], title: "", titles: titleOptionsOf(playerId) };
    }
    const player = findPlayer(playerId);
    if (!player) return null;
    const index = playerId - 1;
    const codes: StoredFriendCode[] = [];
    const code = (seed: number): string => fakeFriendCode(createRandom(seed));
    if (index % 5 !== 4) codes.push({ gameType: 3, region: "SW", lineSeq: 1, label: "", code: code(playerId) });
    if (index % 3 !== 2)
      codes.push({ gameType: 1, region: "PAL", lineSeq: 1, label: "Wii", code: code(playerId + 100) });
    if (index % 4 === 1)
      codes.push({ gameType: 1, region: "NTSC", lineSeq: 1, label: "Dolphin", code: code(playerId + 200) });
    return {
      playerId,
      country: player.country,
      codes,
      title: selectedTitleOf(playerId)?.code ?? "",
      titles: titleOptionsOf(playerId),
    };
  }

  function editedCountry(playerId: number, country: string): string {
    const edited = editedProfiles.get(playerId);
    return edited ? normalizeCountryCode(edited.country) : country;
  }

  // Edited friend codes as the profile shows them (players/mappers.ts loads database code, which fixture
  // mode never does, so the lines are built here like the fixture's own).
  function editedFriendCodes(playerId: number): PlayerProfile["friend_codes"] {
    const codes = [...(editedProfiles.get(playerId)?.codes ?? [])].sort((a, b) => a.lineSeq - b.lineSeq);
    const regionLabels: Readonly<Record<string, string>> = { PAL: "PAL", NTSC: "NTSC-U", JPN: "NTSC-J", KOR: "NTSC-K" };
    const msc = (region: string): string[] =>
      codes
        .filter((row) => row.gameType === 1 && row.region === region)
        .map((row) => `${regionLabels[region] ?? region}${row.label ? ` (${row.label})` : ""}: ${row.code}`);
    return {
      switch: codes.filter((row) => row.gameType === 3).map((row) => `SW-${row.code}`),
      msc: [...msc("PAL"), ...msc("NTSC"), ...msc("JPN"), ...msc("KOR")],
      msc_pal: msc("PAL"),
      msc_ntsc: msc("NTSC"),
      msc_kor: msc("KOR"),
      msc_jpn: msc("JPN"),
    };
  }

  const profileStore: ProfileStore = {
    ensurePlayer: (discordId, name) => {
      if (discordId === linkedUser.id) return Promise.resolve({ playerId: 1, created: false });
      const existing = createdPlayers.get(discordId);
      if (existing) return Promise.resolve({ playerId: existing.player_id, created: false });
      const player = { player_id: players.length + createdPlayers.size + 1, name };
      createdPlayers.set(discordId, player);
      return Promise.resolve({ playerId: player.player_id, created: true });
    },
    findPlayerId: (discordId) =>
      Promise.resolve(discordId === linkedUser.id ? 1 : (createdPlayers.get(discordId)?.player_id ?? null)),
    readProfile: (playerId) => {
      const profile = storedProfileOf(playerId);
      return profile ? Promise.resolve(profile) : Promise.reject(new Error(`Player ${playerId} not found.`));
    },
    countries: () => Promise.resolve(COUNTRY_OPTIONS),
    saveProfile: (playerId, codes, decide) => {
      const current = storedProfileOf(playerId);
      if (!current) return Promise.reject(new Error(`Player ${playerId} not found.`));
      const others = [
        ...players.map((player) => player.player_id),
        ...[...createdPlayers.values()].map((p) => p.player_id),
      ]
        .filter((id) => id !== playerId)
        .flatMap((id) => storedProfileOf(id)?.codes ?? []);
      const taken = codes.filter((key) => others.some((row) => row.gameType === key.gameType && row.code === key.code));
      const decision = decide(current, taken);
      if (decision.plan) editedProfiles.set(playerId, applyPlan(current, decision.plan));
      return Promise.resolve(decision.result);
    },
  };

  // The simulated members' names on the server.
  const members: GuildMemberLookup = {
    getMember: (discordId) => {
      const login = Object.values(loginsByCode).find((entry) => entry.user.id === discordId);
      if (!login) return Promise.resolve(UNKNOWN_MEMBER);
      return Promise.resolve({
        membership: "member",
        nick: login.nick,
        username: toText(login.user.username),
        globalName: toText(login.user.global_name),
      });
    },
  };

  // A profile created at login: nothing in it yet but the name.
  function buildNewPlayerProfile(player: { readonly player_id: number; readonly name: string }): PlayerProfile {
    return {
      player: {
        id: player.player_id,
        name: player.name,
        country: editedCountry(player.player_id, ""),
        club_id: null,
        club_name: "",
        club_tag: "",
        results_url: "",
        activity: generatedAt,
        is_active: true,
        ...titleFieldsOf(player.player_id),
      },
      friend_codes: editedFriendCodes(player.player_id),
      season_awards: [],
      accolades: [],
      ratings: { sms: {}, msc: {}, msbl: {}, sms2v2: {}, msc2v2: {}, msbl2v2: {} },
      season_reward_level: rewardLevel(0),
      highest_rank_banner_url: "",
    };
  }
  const sessions = new SessionManager({
    secret: crypto.randomBytes(32).toString("hex"),
    cookieName: "msc_dev_session",
    cookieSecure: false,
    ttlMs: DAY_MS,
    authStateTtlMs: 600_000,
    now: nowFn,
  });

  const events: EventsPayload = (() => {
    const rows = (
      [
        ["sample-training-cup", "SAMPLE TRAINING CUP", "msbl", "/assets/games/msblball.png"],
        ["demo-charged-classic", "DEMO CHARGED CLASSIC", "msc", "/assets/games/mscball.png"],
        ["fixture-super-series", "FIXTURE SUPER SERIES", "sms", "/assets/games/smsball.png"],
      ] as const
    ).map(([name, displayName, game, imageUrl], position) => ({
      id: `sample-event-${position + 1}`,
      name,
      display_name: displayName,
      game,
      image_url: imageUrl,
      slug: name,
      position,
      url: "/community-tournaments",
    }));
    return { count: rows.length, rows };
  })();

  function publicPayload(key: string): unknown {
    if (key === PLAYERS_LIST_KEY) return { count: players.length, rows: players };
    if (key === MSBL_CLUBS_KEY) return { game: "msbl", count: clubs.length, rows: clubs };
    if (key === COMPETITIVE_SEASON_KEY) {
      return {
        serverNowUtc: new Date(nowFn()).toISOString(),
        season: {
          id: 3,
          seasonNumber: 2,
          displayName: "Dusk Season 2026",
          startDateUtc: iso(-20 * DAY_MS),
          endDateUtc: iso(50 * DAY_MS + 5 * 3600000),
          isActive: true,
          isCompleted: false,
          lifecycleStatus: "active",
        },
      };
    }
    if (key.startsWith("leaderboard:")) {
      const [, game = "", mode = ""] = key.split(":");
      const validated = assertGameAndMode(game, mode);
      const rows = leaderboardRows(validated.game, validated.mode);
      return { game, mode, count: rows.length, rows };
    }
    throw new Error("Unknown fixture data key.");
  }

  return {
    source: "fixtures",
    now: nowFn,
    healthCheck: () => Promise.resolve(),
    publicData: {
      get: (key): Promise<CacheResult> =>
        Promise.resolve({ payload: structuredClone(publicPayload(key)), cacheStatus: "fixture", generatedAt }),
    },
    getLeaderboardRows: (query) => {
      const { game, mode } = assertGameAndMode(query.gameCode, query.modeCode);
      const offset = parseOffset(query.offset);
      return Promise.resolve(leaderboardRows(game, mode).slice(offset, offset + parseLimit(query.limit, 100, 500)));
    },
    getPlayerProfile: (playerId) => {
      const player = findPlayer(playerId);
      return Promise.resolve(player ? buildPlayerProfile(player) : null);
    },
    getPlayerProfileByDiscordId: (discordId) => {
      const player = findPlayer(1);
      if (discordId === linkedUser.id && player) return Promise.resolve(buildPlayerProfile(player));
      const created = createdPlayers.get(discordId);
      return Promise.resolve(created ? buildNewPlayerProfile(created) : null);
    },
    profiles: createProfileService({ store: profileStore, members }),
    getProfileStatsByDiscordId: (discordId) => {
      if (discordId === linkedUser.id) return Promise.resolve(sampleProfileStats());
      return Promise.resolve(createdPlayers.has(discordId) ? buildProfileStats([]) : null);
    },
    getClubProfile: (clubId) => {
      const club = findClub(clubId);
      return Promise.resolve(club ? buildClubProfile(club) : null);
    },
    getClubLogoFile: (clubIdRaw) => {
      const club = findClub(clubIdRaw);
      return Promise.resolve(
        club?.logo
          ? {
              absolutePath: path.join(import.meta.dirname, "club-logo.svg"),
              contentType: "image/svg+xml",
              hash: "synthetic-v1",
              byteLength: 0,
            }
          : null,
      );
    },
    getCommunityEvents: () => Promise.resolve(structuredClone(events)),
    getWiimmfiPlayers: () =>
      Promise.resolve([
        { region: "R4QP", friendCode: "0000-0000-0001", name: "Sample Player" },
        { region: "R4QE", friendCode: "0000-0000-0002", name: "Pixel Piranha" },
        { region: "R4QJ", friendCode: "0000-0000-0003", name: "サンプル" },
        { region: "R4QK", friendCode: "0000-0000-0004", name: "Turbo Shell" },
      ]),
    login: { sessions, oauth },
    start: () => undefined,
    stop: () => Promise.resolve(),
  };
}
