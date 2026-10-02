// Maps player rows and the profile batch (repository.ts) to the public DTOs.

import { normalizeCountryCode } from "@ms/shared/countries";
import {
  COMPETITIVE_RANK_ICON_BASE_URL,
  COMPETITIVE_RANK_ICON_BY_NUMBER,
  SEASON_REWARD_LEVEL_BASE_URL,
  SEASON_REWARD_LEVEL_BY_ORDER,
  versionedAssetUrl,
} from "@ms/shared/ranks";
import { normalizeText, toText } from "@ms/shared/text";
import { isActivityActive, toActivityIso, toIsoDateOnly } from "../../lib/dates.ts";
import { toPositiveIntId, toPositiveIntOrNull, toSafeCount } from "../../lib/numbers.ts";
import { selectedTitle, titleText, type CatalogTitle } from "../titles/availability.ts";
import { PROFILE_RECORDSET } from "./repository.ts";

type Row = Record<string, unknown>;

const COMPETITIVE_UNRANKED_RANK_ICON_URL = versionedAssetUrl(SEASON_REWARD_LEVEL_BASE_URL + "0-unranked.png");
const GOLD_MEDAL = "🥇";

// Winning an MSL World Championship is the top honour in the scene, so profiles highlight it.
// Both halves count: the gold medal AND the event. Verified against the live tournament table -
// no tournament carries "MSL" anywhere but at the start, and there is no World Championship
// without the MSL prefix, so matching on the name is unambiguous.
const MSL_WORLD_CHAMPIONSHIP = /^MSL\b.*\bWorld Championship\b/i;

export interface FriendCodes {
  switch: string[];
  msc: string[];
  msc_pal: string[];
  msc_ntsc: string[];
  msc_kor: string[];
  msc_jpn: string[];
}

export interface SeasonRewardLevelDto {
  order: number;
  name: string;
  image_url: string;
  current_wins?: number;
  required_wins?: number;
}

export interface RatingCard {
  rating: number | null;
  sets: string;
  games: string;
  rank_emoji: string;
  rank_icon_url: string;
  competitive_rank: string;
  competitive_rank_number: number | null;
  season_reward_level: SeasonRewardLevelDto;
  /** All-time legacy rating of 1v1 cards. */
  whr?: number | null;
  /** Legacy TrueSkill rating of 2v2 cards. */
  tst?: number | null;
}

/** A rating card, or {} when the player has no card for that game and mode. */
export type RatingBlock = Partial<RatingCard>;

export interface PlayerListItem {
  player_id: number | null;
  name: string;
  display_name: string;
  country: string;
  club_id: number | null;
  club_name: string;
  club_tag: string;
  activity: string | null;
  is_active: boolean;
}

export interface SeasonAward {
  season_name: string;
  game_code: string;
  mode_code: string;
  award_code: string;
  award_name: string;
  rank_position: number | null;
  metric_label: string;
}

export interface Accolade {
  place_medal: string;
  game_code: string;
  tournament_name: string;
  start_date: string;
  is_winner: boolean;
  is_world_champion: boolean;
}

export interface PlayerProfile {
  player: {
    id: number | null;
    name: string;
    country: string;
    club_id: number | null;
    club_name: string;
    club_tag: string;
    results_url: string;
    activity: string | null;
    is_active: boolean;
    /** The selected player title in FULL CAPS; "" for none. */
    title: string;
    /** Its look for the later formatting ("green"); "" for the plain one. */
    title_style: string;
  };
  friend_codes: FriendCodes;
  season_awards: SeasonAward[];
  accolades: Accolade[];
  ratings: Record<"sms" | "msc" | "msbl" | "sms2v2" | "msc2v2" | "msbl2v2", RatingBlock>;
  season_reward_level: SeasonRewardLevelDto;
  highest_rank_banner_url: string;
}

function roundOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function normalizeRecordPair(value: unknown): string {
  const text = normalizeText(value);
  if (!text) return "-";
  const match = /^(\d+)\s*-\s*(\d+)$/.exec(text);
  return match ? `${match[1]}-${match[2]}` : text;
}

function recordHasResults(value: unknown): boolean {
  const match = /^(\d+)\s*-\s*(\d+)$/.exec(normalizeText(value));
  return Boolean(match) && Number(match?.[1]) + Number(match?.[2]) > 0;
}

export function normalizeResultsUrl(resultsValue: unknown, idStartGG: unknown): string {
  const results = normalizeText(resultsValue);
  if (results) {
    if (/^https?:\/\//i.test(results)) return results;
    if (/^start\.gg\//i.test(results)) return "https://" + results;
  }
  const startGgId = normalizeText(idStartGG).replace(/^@+/, "");
  if (!startGgId) return "";
  if (/^https?:\/\//i.test(startGgId)) return startGgId;
  return `https://start.gg/user/${encodeURIComponent(startGgId)}/results`;
}

function normalizeAccoladeMedal(value: unknown): string {
  const text = toText(value).toLowerCase();
  if (text.includes("first") || text.includes("gold")) return "🥇";
  if (text.includes("second") || text.includes("silver")) return "🥈";
  if (text.includes("third") || text.includes("bronze")) return "🥉";
  return "•";
}

type FriendCodeBucket = "switch" | "msc_pal" | "msc_ntsc" | "msc_kor" | "msc_jpn" | "";

function resolveFriendCodeBucket(gameTypeValue: unknown, regionValue: unknown): FriendCodeBucket {
  const gameType = Number(gameTypeValue);
  const region = normalizeText(regionValue).toUpperCase();
  if (gameType === 3) return "switch";
  if (gameType === 1) {
    if (region === "PAL") return "msc_pal";
    if (region === "NTSC") return "msc_ntsc";
    if (region === "KOR") return "msc_kor";
    if (region === "JPN") return "msc_jpn";
  }
  return "";
}

function getMscRegionLabel(regionValue: unknown): string {
  const region = normalizeText(regionValue).toUpperCase();
  if (region === "NTSC") return "NTSC-U";
  if (region === "JPN") return "NTSC-J";
  if (region === "KOR") return "NTSC-K";
  return region || "MSC";
}

function formatTwelveDigitFriendCode(value: unknown): string {
  const raw = normalizeText(value);
  const digits = raw.replace(/^SW[\s-]*/i, "").replace(/\D/g, "");
  return digits.length === 12 ? `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8, 12)}` : raw;
}

function formatFriendCodeValue(bucket: FriendCodeBucket, codeValue: unknown): string {
  const code = formatTwelveDigitFriendCode(codeValue);
  if (!code) return "";
  if (bucket !== "switch" || /^SW-/i.test(code)) return code;
  return "SW-" + code;
}

const FRIEND_CODE_REGION_ORDER: Readonly<Record<string, number>> = { PAL: 1, NTSC: 2, JPN: 3, KOR: 4 };

function getFriendCodeSortRank(row: Row): number[] {
  const bucket = resolveFriendCodeBucket(row.GameType, row.Region);
  const region = normalizeText(row.Region).toUpperCase();
  const regionOrder = Object.hasOwn(FRIEND_CODE_REGION_ORDER, region) ? (FRIEND_CODE_REGION_ORDER[region] ?? 9) : 9;
  return [bucket === "switch" ? 0 : 1, bucket === "switch" ? 0 : regionOrder, toPositiveIntId(row.LineSeq) ?? 9999];
}

function compareFriendCodeRows(a: Row, b: Row): number {
  const left = getFriendCodeSortRank(a);
  const right = getFriendCodeSortRank(b);
  for (let index = 0; index < left.length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function buildFriendCodes(rows: readonly Row[]): FriendCodes {
  const grouped: FriendCodes = { switch: [], msc: [], msc_pal: [], msc_ntsc: [], msc_kor: [], msc_jpn: [] };
  for (const row of rows.slice().sort(compareFriendCodeRows)) {
    const bucket = resolveFriendCodeBucket(row.GameType, row.Region);
    if (!bucket) continue;
    const code = formatFriendCodeValue(bucket, row.Code);
    if (!code) continue;
    if (bucket === "switch") {
      grouped.switch.push(code);
      continue;
    }
    const label = normalizeText(row.Label);
    const line = `${getMscRegionLabel(row.Region)}${label ? ` (${label})` : ""}: ${code}`;
    grouped.msc.push(line);
    grouped[bucket].push(line);
  }
  return grouped;
}

/** Duplicate names get the club tag, or the player id when there is no club, as a suffix. */
export function buildPlayerDisplayName(row: Row | null, name: unknown): string {
  const playerName = normalizeText(name);
  if (!row || (row.duplicate_name !== true && Number(row.duplicate_name) !== 1)) return playerName;
  const clubTag = normalizeText(row.club_tag);
  if (clubTag) return `${playerName} [${clubTag}]`;
  const playerId = toPositiveIntId(row.player_id);
  return playerId ? `${playerName} [#${playerId}]` : playerName;
}

export function toPlayerListDTO(
  row: Row,
  options: { now?: unknown; activityWindowDays?: unknown } = {},
): PlayerListItem | null {
  const name = normalizeText(row.name);
  if (!name) return null;
  return {
    player_id: Number(row.player_id) || null,
    name,
    display_name: buildPlayerDisplayName(row, name),
    country: normalizeCountryCode(row.country),
    club_id: Number(row.club_id) || null,
    club_name: normalizeText(row.club_name),
    club_tag: normalizeText(row.club_tag),
    activity: toActivityIso(row.activity),
    is_active: isActivityActive(row.activity, options.now, options.activityWindowDays),
  };
}

function hasCompetitiveMatches(row: Row | null): boolean {
  return toSafeCount(row?.MatchWins) + toSafeCount(row?.MatchLosses) > 0;
}

function getCompetitiveRankIconUrl(rankNumberValue: unknown): string {
  const rankNumber = Number(rankNumberValue);
  if (rankNumber === 0) return COMPETITIVE_UNRANKED_RANK_ICON_URL;
  const fileName = Number.isFinite(rankNumber) ? COMPETITIVE_RANK_ICON_BY_NUMBER[rankNumber] : undefined;
  return fileName ? versionedAssetUrl(COMPETITIVE_RANK_ICON_BASE_URL + fileName) : "";
}

export function buildSeasonRewardLevel(orderValue: unknown): SeasonRewardLevelDto {
  const parsedOrder = Number(orderValue);
  const order = Number.isInteger(parsedOrder) && SEASON_REWARD_LEVEL_BY_ORDER[parsedOrder] ? parsedOrder : 0;
  const level = SEASON_REWARD_LEVEL_BY_ORDER[order] ?? { name: "Unranked", image: "0-unranked.png" };
  return { order, name: level.name, image_url: versionedAssetUrl(SEASON_REWARD_LEVEL_BASE_URL + level.image) };
}

function toRewardWins(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

interface PlacementProgress {
  readonly currentWins: number;
  readonly requiredWins: number;
  readonly placementComplete: boolean;
}

function normalizePlacementProgress(competitive: Row | null): PlacementProgress | null {
  if (!competitive) return null;
  const rankNumber = Number(competitive.RankNumber);
  const placementPlayed = toSafeCount(competitive.PlacementPlayed);
  const totalMatches = toSafeCount(competitive.MatchWins) + toSafeCount(competitive.MatchLosses);
  return {
    currentWins: Math.min(5, Math.max(placementPlayed, totalMatches)),
    requiredWins: 5,
    placementComplete: Boolean(competitive.PlacementComplete) || placementPlayed >= 5 || rankNumber > 0,
  };
}

function buildSeasonRewardProgressLevel(
  row: Row | null,
  placementProgress: PlacementProgress | null,
): SeasonRewardLevelDto {
  const requiredWins = Math.max(1, toRewardWins(row?.RequiredWins, 5));
  if (!row) {
    return {
      ...buildSeasonRewardLevel(placementProgress?.placementComplete ? 1 : 0),
      current_wins:
        placementProgress && !placementProgress.placementComplete
          ? Math.min(requiredWins, placementProgress.currentWins)
          : 0,
      required_wins: placementProgress ? placementProgress.requiredWins : requiredWins,
    };
  }

  const highestOrder = Number(row.HighestEarnedTierOrder);
  const targetOrder = Number(row.CurrentTargetTierOrder);
  // A valid current target / earned tier is an actual reward tier (Bronze=1 … Titan=7);
  // order 0 (Unranked) is never a reward target. NB: Number(null) === 0, so the `> 0` guard
  // also treats "no current target left" (all tiers earned) as the all-earned case.
  const isTargetValid =
    Number.isInteger(targetOrder) && targetOrder > 0 && Boolean(SEASON_REWARD_LEVEL_BY_ORDER[targetOrder]);
  const isHighestEarnedTier =
    Number.isInteger(highestOrder) && highestOrder > 0 && Boolean(SEASON_REWARD_LEVEL_BY_ORDER[highestOrder]);
  const targetWins = Math.min(
    requiredWins,
    toRewardWins(row.CurrentTargetWins, placementProgress ? placementProgress.currentWins : 0),
  );

  // A completed tier is shown at full — e.g. "Bronze 5/5" — until the next tier records its
  // first qualifying win. Completion resets the target's win count to 0 (and advances the
  // target), so "earned a tier AND the current target has no wins yet" means just-completed;
  // "no current target left" means every tier is earned. Otherwise show the in-progress tier
  // with its live win count, e.g. "Silver 2/5".
  if (isHighestEarnedTier && (!isTargetValid || targetWins === 0)) {
    return { ...buildSeasonRewardLevel(highestOrder), current_wins: requiredWins, required_wins: requiredWins };
  }
  return {
    ...buildSeasonRewardLevel(isTargetValid ? targetOrder : 0),
    current_wins: targetWins,
    required_wins: requiredWins,
  };
}

export function buildCompetitiveRatingsByKey(rows: readonly Row[]): Map<string, Row> {
  const map = new Map<string, Row>();
  for (const row of rows) {
    const gameType = Number(row.GameType);
    const mode = normalizeText(row.Mode).toLowerCase();
    if (!gameType || !mode) continue;
    map.set(`${gameType}:${mode}`, row);
  }
  return map;
}

function buildRewardProgressByKey(rows: readonly Row[]): Map<string, Row> {
  const map = new Map<string, Row>();
  for (const row of rows) {
    const gameId = Number(row.GameId);
    const mode = normalizeText(row.ModeCode).toLowerCase();
    if (!gameId || !mode) continue;
    map.set(`${gameId}:${mode}`, row);
  }
  return map;
}

function lookup(map: Map<string, Row>, gameType: number, mode: string): Row | null {
  return map.get(`${gameType}:${mode.toLowerCase()}`) ?? null;
}

interface RatingBlockOptions {
  readonly competitive: Row | null;
  readonly rewardProgress: Row | null;
  readonly competitiveHistory?: Row | null;
  readonly alwaysShow?: boolean;
  readonly games: unknown;
  readonly metricName: "whr" | "tst";
  readonly metricValue: unknown;
}

// A player has history in a game once they have a legacy result or a rated match in any season.
function hasPlayedEver(options: RatingBlockOptions): boolean {
  return recordHasResults(options.games) || toSafeCount(options.competitiveHistory?.TotalMatches) > 0;
}

// A card normally needs a rated match in the active season. With alwaysShow (1v1) it stays up for
// anyone with history in that game, showing the rating carried into the season; only a player who
// has never played the game at all gets no card.
export function buildRatingBlock(options: RatingBlockOptions): RatingBlock {
  const { competitive } = options;
  if (!hasCompetitiveMatches(competitive) && !(options.alwaysShow && hasPlayedEver(options))) return {};
  const rankNumber = competitive ? Number(competitive.RankNumber) : Number.NaN;
  const wins = toSafeCount(competitive?.MatchWins);
  const losses = toSafeCount(competitive?.MatchLosses);
  return {
    rating: competitive ? roundOrNull(competitive.Elo) : null,
    sets: `${wins}-${losses}`,
    games: normalizeRecordPair(options.games),
    rank_emoji: "",
    rank_icon_url: getCompetitiveRankIconUrl(rankNumber),
    competitive_rank: normalizeText(competitive?.RankName),
    competitive_rank_number: Number.isFinite(rankNumber) ? rankNumber : null,
    season_reward_level: buildSeasonRewardProgressLevel(
      options.rewardProgress,
      normalizePlacementProgress(competitive),
    ),
    [options.metricName]: roundOrNull(options.metricValue),
  };
}

export function buildRatings(
  profile: Row | null,
  competitiveRatings: readonly Row[],
  rewardProgressRows: readonly Row[] = [],
  competitiveHistoryRows: readonly Row[] = [],
): PlayerProfile["ratings"] {
  const ratings = buildCompetitiveRatingsByKey(competitiveRatings);
  const history = buildCompetitiveRatingsByKey(competitiveHistoryRows);
  const rewards = buildRewardProgressByKey(rewardProgressRows);
  const oneVsOne = (gameType: number, games: string, rating: string): RatingBlock =>
    buildRatingBlock({
      competitive: lookup(ratings, gameType, "1v1"),
      rewardProgress: lookup(rewards, gameType, "1v1"),
      competitiveHistory: lookup(history, gameType, "1v1"),
      alwaysShow: true,
      games: profile?.[games],
      metricName: "whr",
      metricValue: profile?.[rating],
    });
  const twoVsTwo = (gameType: number, games: string, rating: string): RatingBlock =>
    buildRatingBlock({
      competitive: lookup(ratings, gameType, "2v2"),
      rewardProgress: lookup(rewards, gameType, "2v2"),
      games: profile?.[games],
      metricName: "tst",
      metricValue: profile?.[rating],
    });
  return {
    sms: oneVsOne(2, "SmsRecord", "SmsRating"),
    msc: oneVsOne(1, "MscRecord", "MscRating"),
    msbl: oneVsOne(3, "BlRecord", "BlRating"),
    sms2v2: twoVsTwo(2, "SmsRecord2v2", "SmsRating2v2"),
    msc2v2: twoVsTwo(1, "MscRecord2v2", "MscRating2v2"),
    msbl2v2: twoVsTwo(3, "BlRecord2v2", "BlRating2v2"),
  };
}

// Season display names are stored as "<Name> Season <Year>"; profiles show "<Name> <Year>".
// Only the standalone middle word is dropped, so a name without it survives untouched.
export function formatSeasonAwardSeasonName(value: unknown): string {
  return normalizeText(value).replace(/^(.*\S)\s+Season\s+(\S.*)$/i, "$1 $2");
}

// Season awards are written once, when a season is finalized, and never change afterwards.
export function buildSeasonAwards(rows: unknown): SeasonAward[] {
  return (Array.isArray(rows) ? (rows as Row[]) : [])
    .map((row) => ({
      season_name: formatSeasonAwardSeasonName(row.SeasonName),
      game_code: normalizeText(row.Game).toUpperCase(),
      mode_code: normalizeText(row.ModeCode).toLowerCase(),
      award_code: normalizeText(row.AwardCode),
      award_name: normalizeText(row.AwardName),
      rank_position: toPositiveIntOrNull(row.RankPosition),
      metric_label: normalizeText(row.MetricLabel),
    }))
    .filter((award) => award.season_name !== "" && award.award_name !== "");
}

export function isWorldChampionTitle(placeMedal: string, tournamentName: unknown): boolean {
  return placeMedal === GOLD_MEDAL && MSL_WORLD_CHAMPIONSHIP.test(toText(tournamentName));
}

// Every accolade is an event, so the word carries no information on the line. Stripped for display
// only - dbo.Tournament keeps the official name. Handles the two rows that carry it mid-name
// ("... - March Live Event Consolation") as well as the 108 that end on it.
export function stripEventWord(value: unknown): string {
  return toText(value)
    .replace(/\bevents?\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*[-–—]\s*$/, "")
    .trim();
}

// The gold line names a person, not a bracket: a world champion IS the champion. Silver and bronze
// keep "Championship", because they did not win it.
export function formatAccoladeTournamentName(name: unknown, isWorldChampion: boolean): string {
  const stripped = stripEventWord(name);
  return isWorldChampion ? stripped.replace(/\bChampionship\b/i, "Champion") : stripped;
}

export function buildAccolades(rows: readonly Row[]): Accolade[] {
  return rows
    .map((row) => {
      const placeMedal = normalizeAccoladeMedal(row.Place);
      const rawName = normalizeText(row.Name);
      const isWorldChampion = isWorldChampionTitle(placeMedal, rawName);
      return {
        place_medal: placeMedal,
        game_code: normalizeText(row.Game).toUpperCase(),
        tournament_name: formatAccoladeTournamentName(rawName, isWorldChampion),
        start_date: toIsoDateOnly(row.TournamentStartDate),
        is_winner: placeMedal === GOLD_MEDAL,
        is_world_champion: isWorldChampion,
      };
    })
    .filter((accolade) => accolade.tournament_name !== "")
    .sort((a, b) => {
      if (a.start_date && b.start_date && a.start_date !== b.start_date)
        return b.start_date.localeCompare(a.start_date);
      return a.tournament_name.localeCompare(b.tournament_name);
    });
}

function getRecordset(recordsets: unknown, index: number): Row[] {
  const set = Array.isArray(recordsets) ? (recordsets as unknown[])[index] : undefined;
  return Array.isArray(set) ? (set as Row[]) : [];
}

/** The selected title, while the player can still select it (the batch's last two result sets). */
export function buildPlayerTitle(
  selectedRows: readonly Row[],
  unlockedRows: readonly Row[],
  catalog: readonly CatalogTitle[],
): Pick<PlayerProfile["player"], "title" | "title_style"> {
  const unlocked = unlockedRows.map((row) => Number(row.title_id));
  const title = selectedTitle(catalog, unlocked, toPositiveIntId(selectedRows[0]?.title_id));
  return { title: title ? titleText(title.name) : "", title_style: title?.styleKey ?? "" };
}

/** The profile DTO from the eleven result sets of the profile batch; null when the player is missing. */
export function buildPlayerProfileFromRecordsets(
  recordsets: unknown,
  titleCatalog: readonly CatalogTitle[] = [],
): PlayerProfile | null {
  const playerRow = getRecordset(recordsets, PROFILE_RECORDSET.player)[0];
  const name = normalizeText(playerRow?.name);
  if (!playerRow || !name) return null;

  const profileData = getRecordset(recordsets, PROFILE_RECORDSET.summary)[0] ?? {};
  const rewardRow = getRecordset(recordsets, PROFILE_RECORDSET.rewardLevel)[0];
  const activity = playerRow.activity || null;
  return {
    player: {
      id: Number(playerRow.player_id) || null,
      name,
      country: normalizeCountryCode(playerRow.country),
      club_id: Number(playerRow.club_id) || null,
      club_name: normalizeText(playerRow.club_name),
      club_tag: normalizeText(playerRow.club_tag),
      results_url: normalizeResultsUrl(profileData.ResultsStartGG, normalizeText(playerRow.id_start_gg)),
      activity: toActivityIso(activity),
      is_active: isActivityActive(activity),
      ...buildPlayerTitle(
        getRecordset(recordsets, PROFILE_RECORDSET.selectedTitle),
        getRecordset(recordsets, PROFILE_RECORDSET.unlockedTitles),
        titleCatalog,
      ),
    },
    friend_codes: buildFriendCodes(getRecordset(recordsets, PROFILE_RECORDSET.friendCodes)),
    season_awards: buildSeasonAwards(getRecordset(recordsets, PROFILE_RECORDSET.seasonAwards)),
    accolades: buildAccolades(getRecordset(recordsets, PROFILE_RECORDSET.accolades)),
    ratings: buildRatings(
      profileData,
      getRecordset(recordsets, PROFILE_RECORDSET.competitiveRatings),
      getRecordset(recordsets, PROFILE_RECORDSET.rewardProgress),
      getRecordset(recordsets, PROFILE_RECORDSET.competitiveHistory),
    ),
    season_reward_level: buildSeasonRewardLevel(rewardRow?.RewardLevelOrder),
    highest_rank_banner_url: "",
  };
}
