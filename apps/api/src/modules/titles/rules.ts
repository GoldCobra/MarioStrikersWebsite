// Which titles the data awards: pure rules over a snapshot of the sources (repository.ts reads it). A
// title's RuleKind and its JSON RuleParams (dbo.PlayerTitle) choose its rule, and its GameCode the game
// whose tournaments, wins or rewards count (games.ts; without one, every game counts as before):
//
//   everyone                  Free Titles: nothing to award, the category is global
//   manual                    staff only
//   fixed-players             {"players": [{"player_id": n, "discord_id": "…"}]}: exactly these players, each
//                             only while dbo.Player still has that Discord account (the fixed WFC titles)
//   season-titan              {"season_id": n}: Strikers Titan reward level 5/5 in that season (any mode; the
//                             rank alone is not enough), awarded once the season is completed. A season that
//                             ends with a Titan in a game gets its title "<SEASON> <YEAR> STRIKERS TITAN" for
//                             that game created here.
//   msl-event                 {"names": [...]}: a template, never awarded itself. For every game in which a
//                             completed tournament with exactly these names has a winner, its game variant
//                             (code "<template>-<game>", RuleKind tournament-name) is created and awarded.
//   tournament-name           {"names": [...]}: winners of the completed tournaments with exactly these names
//   world-championship-count  {"min": n}: at least n won MSL World Championships
//   side-tournament-count     {"min": n}: at least n clear wins of completed non-MSL tournaments
//   legacy-rank               {"tier": 1-5}: the highest legacy rank held when the competitive ranks began
//
// Unclear data awards nothing and becomes an open point instead: team and doubles wins, side brackets, a
// winner that is no player, a legacy rank that rests on matches played after the competitive start.

import { normalizeText, toText } from "@ms/shared/text";
import { formatSeasonAwardSeasonName } from "../players/mappers.ts";
import { titleText, type CatalogTitle } from "./availability.ts";
import { TEMPLATE_RULE_KIND, TITLE_CATEGORY } from "./catalog.ts";
import { gameByCode, gameByType, gameLabel, type TitleGame, type TitleGameCode } from "./games.ts";
import { LEGACY_MIN_MATCHES, LEGACY_RANK_NAMES, legacyTier } from "./legacy.ts";

export { legacyTier } from "./legacy.ts";

/** CompetitiveSeasonRewardEarned.TierOrder of Strikers Titan (packages/shared/src/ranks.ts). */
export const TITAN_REWARD_TIER_ORDER = 7;

/** Every MSL event, also the side events with MSL in their name; none counts as a tournament win. */
const MSL = /\bMSL\b/i;

/** An MSL World Championship, by the exact form of its name ("MSL 2023 World Championship"). */
export const WORLD_CHAMPIONSHIP = /^MSL (?:Season \d+|\d{4}) World Championship$/i;
const WORLD_CHAMPIONSHIP_LIKE = /^MSL\b.*\bWorld Championship\b/i;

/** Side brackets and divisions: their wins are not counted for tournament titles until staff decide. */
export const SIDE_BRACKET = /\b(?:consolation|bracket|division|amateur|rookie)\b|kritter memorial/i;

export interface TournamentRow {
  readonly id: number;
  readonly name: string;
  readonly gameType: number;
  readonly isComplete: boolean;
  /** dbo.Tournament.Winner: player ids, comma-separated. */
  readonly winner: string;
  /** ISO date; "" when unknown. */
  readonly startDate: string;
}

export interface SeasonRow {
  readonly id: number;
  readonly seasonNumber: number;
  readonly displayName: string;
  /** CompetitiveSeason.LifecycleStatus: "completed" once the season has ended. */
  readonly status: string;
}

/** A player who earned the Strikers Titan reward level in a season, in one game (CompetitiveGame.Id). */
export interface TitanRow {
  readonly seasonId: number;
  readonly playerId: number;
  readonly gameType: number;
}

/** A stored legacy rank (PlayerStats.Rank or Rank2v2) and the legacy matches before the competitive start. */
export interface LegacyRankRow {
  readonly playerId: number;
  readonly gameType: number;
  readonly mode: "1v1" | "2v2";
  readonly rank: number;
  readonly matchesBefore: number;
}

export interface UnlockRow {
  readonly playerId: number;
  readonly titleId: number;
}

export interface TitleSources {
  readonly catalog: readonly CatalogTitle[];
  readonly unlocks: readonly UnlockRow[];
  readonly playerIds: ReadonlySet<number>;
  /** dbo.Player.DiscordID by player id: a fixed title goes to its player only with this account. */
  readonly discordIds: ReadonlyMap<number, string>;
  readonly tournaments: readonly TournamentRow[];
  readonly seasons: readonly SeasonRow[];
  readonly titans: readonly TitanRow[];
  /** Read by the full run only (ops:title-sync): legacy ranks no longer change. */
  readonly legacyRanks?: readonly LegacyRankRow[];
}

export type TitleSourceType = "SEASON" | "ACCOLADE" | "TOURNAMENT" | "LEGACY_RANK" | "MANUAL";

export interface TitleGrant {
  readonly playerId: number;
  readonly titleCode: string;
  readonly sourceType: TitleSourceType;
  /** Where it comes from, e.g. "Tournament:211 MSL 2023 World Championship" (at most 200 characters). */
  readonly sourceRef: string;
}

/** A title to create before its grants: a season title or an MSL event's game variant, of one game. */
export interface NewTitle {
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly sortOrder: number;
  readonly ruleKind: "season-titan" | "tournament-name";
  readonly ruleParams: string;
  readonly gameCode: TitleGameCode;
}

export interface TitleAwardPlan {
  readonly newTitles: readonly NewTitle[];
  /** Only unlocks the players do not have yet. */
  readonly grants: readonly TitleGrant[];
  readonly openPoints: readonly string[];
}

/** The player ids of a Winner column; [] when it names nobody, null when it holds anything else ("-1"). */
export function parseWinners(value: unknown): number[] | null {
  const ids = toText(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number);
  return ids.every((id) => Number.isInteger(id) && id > 0) ? [...new Set(ids)] : null;
}

/** "Dusk Season 2026" → "DUSK 2026 STRIKERS TITAN". */
export function seasonTitanTitleName(displayName: string): string {
  return `${titleText(formatSeasonAwardSeasonName(displayName))} STRIKERS TITAN`;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

interface Tournament extends TournamentRow {
  readonly winners: number[] | null;
}

/**
 * The tournaments in date order and the wins the rules count: MSL World Championships and clear wins of
 * completed non-MSL tournaments, per player in all games (each rule filters its game). `note` gets the
 * unclear cases.
 */
function winCounter(sources: Pick<TitleSources, "tournaments" | "playerIds">, note: (text: string) => void) {
  const tournaments: Tournament[] = sources.tournaments
    .map((row) => ({ ...row, name: normalizeText(row.name), winners: parseWinners(row.winner) }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id - b.id);
  const label = (tournament: Tournament): string =>
    `Tournament ${tournament.id} "${tournament.name}" (${gameLabel(tournament.gameType)})`;

  /** The winners of a completed tournament who are players; null when it records none. */
  function recordedWinners(tournament: Tournament): number[] | null {
    if (!tournament.winners?.length) return null;
    const players = tournament.winners.filter((id) => {
      if (sources.playerIds.has(id)) return true;
      note(`${label(tournament)}: winner ${id} is no player, so it awards nothing to them.`);
      return false;
    });
    return players.length ? players : null;
  }

  let worldChampionships: Map<number, Tournament[]> | null = null;
  function championshipWins(): Map<number, Tournament[]> {
    if (worldChampionships) return worldChampionships;
    worldChampionships = new Map();
    for (const tournament of tournaments) {
      if (!WORLD_CHAMPIONSHIP.test(tournament.name)) {
        if (WORLD_CHAMPIONSHIP_LIKE.test(tournament.name)) {
          note(`${label(tournament)}: named like a World Championship but not counted as one.`);
        }
        continue;
      }
      if (!tournament.isComplete) continue;
      for (const playerId of recordedWinners(tournament) ?? []) {
        worldChampionships.set(playerId, [...(worldChampionships.get(playerId) ?? []), tournament]);
      }
    }
    return worldChampionships;
  }

  let sideWins: Map<number, Tournament[]> | null = null;
  function tournamentWins(): Map<number, Tournament[]> {
    if (sideWins) return sideWins;
    sideWins = new Map();
    for (const tournament of tournaments) {
      if (MSL.test(tournament.name) || !tournament.isComplete) continue;
      const winners = recordedWinners(tournament);
      if (!winners) continue;
      const unclear =
        winners.length > 1
          ? "a team or doubles win"
          : SIDE_BRACKET.test(tournament.name)
            ? "a side bracket or division"
            : gameByType(tournament.gameType)
              ? ""
              : "not one game";
      if (unclear) {
        note(`${label(tournament)}: ${unclear}, not counted for TOURNAMENT WINNER until staff decide.`);
        continue;
      }
      const [playerId] = winners as [number];
      sideWins.set(playerId, [...(sideWins.get(playerId) ?? []), tournament]);
    }
    return sideWins;
  }
  return { tournaments, label, recordedWinners, championshipWins, tournamentWins };
}

/** The counted wins of every player (all games; TournamentRow.gameType tells the game), without open points. */
export function countedWins(sources: Pick<TitleSources, "tournaments" | "playerIds">): {
  readonly championships: ReadonlyMap<number, readonly TournamentRow[]>;
  readonly side: ReadonlyMap<number, readonly TournamentRow[]>;
} {
  const counter = winCounter(sources, () => undefined);
  return { championships: counter.championshipWins(), side: counter.tournamentWins() };
}

export function planTitleAwards(sources: TitleSources): TitleAwardPlan {
  const grants: TitleGrant[] = [];
  const newTitles: NewTitle[] = [];
  const openPoints: string[] = [];
  const noted = new Set<string>();
  const note = (text: string): void => {
    if (noted.has(text)) return;
    noted.add(text);
    openPoints.push(text);
  };

  const codeById = new Map(sources.catalog.map((title) => [title.id, title.code]));
  const titleByCode = new Map(sources.catalog.map((title) => [title.code, title]));
  const held = new Set(sources.unlocks.map((unlock) => `${unlock.playerId}|${codeById.get(unlock.titleId) ?? ""}`));
  const grant = (playerId: number, titleCode: string, sourceType: TitleSourceType, sourceRef: string): void => {
    const key = `${playerId}|${titleCode}`;
    if (held.has(key)) return;
    held.add(key);
    grants.push({ playerId, titleCode, sourceType, sourceRef: sourceRef.slice(0, 200) });
  };
  /** Creates a title once per run unless the catalog has it; false when the catalog has it retired. */
  const ensureTitle = (title: NewTitle): boolean => {
    const existing = titleByCode.get(title.code);
    if (existing) return existing.isActive;
    if (!newTitles.some((planned) => planned.code === title.code)) newTitles.push(title);
    return true;
  };

  const { tournaments, label, recordedWinners, championshipWins, tournamentWins } = winCounter(sources, note);
  /** Whether a tournament counts for a title of `game` (every tournament for a title without a game). */
  const inGame = (tournament: Tournament, game: TitleGame | null): boolean =>
    !game || tournament.gameType === game.gameType;

  let legacy: Map<number, { tier: number; row: LegacyRankRow }> | null = null;
  function bestLegacyRanks(rows: readonly LegacyRankRow[]): Map<number, { tier: number; row: LegacyRankRow }> {
    if (legacy) return legacy;
    legacy = new Map();
    const unclear: LegacyRankRow[] = [];
    for (const row of rows) {
      const tier = legacyTier(row.rank);
      if (!tier || !sources.playerIds.has(row.playerId)) continue;
      if (row.matchesBefore < LEGACY_MIN_MATCHES[row.mode]) {
        unclear.push(row);
        continue;
      }
      const best = legacy.get(row.playerId);
      if (!best || tier > best.tier || (tier === best.tier && row.rank > best.row.rank)) {
        legacy.set(row.playerId, { tier, row });
      }
    }
    for (const row of unclear) {
      const tier = legacyTier(row.rank);
      if (tier <= (legacy.get(row.playerId)?.tier ?? 0)) continue;
      note(
        `Player ${row.playerId}: legacy ${LEGACY_RANK_NAMES[tier] ?? ""} (${gameByType(row.gameType)?.code ?? row.gameType} ${row.mode}) ` +
          `rests on ${row.matchesBefore} matches before the competitive start (${LEGACY_MIN_MATCHES[row.mode]} needed), not counted.`,
      );
    }
    return legacy;
  }

  for (const title of sources.catalog) {
    if (!title.isActive) continue;
    let params: Record<string, unknown> = {};
    if (title.ruleParams) {
      try {
        const parsed: unknown = JSON.parse(title.ruleParams);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("no object");
        params = parsed as Record<string, unknown>;
      } catch {
        note(`Title ${title.code}: RuleParams is no JSON object, so it awards nothing.`);
        continue;
      }
    }
    const name = titleText(title.name);
    const game = gameByCode(title.gameCode);
    switch (title.ruleKind) {
      case "everyone":
      case "manual":
      case "season-titan":
        break;
      case "fixed-players": {
        const players = Array.isArray(params.players) ? (params.players as unknown[]) : [];
        if (!players.length) {
          note(`Title ${title.code}: RuleParams need "players".`);
          break;
        }
        for (const entry of players) {
          const fields = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
          const playerId = positiveInt(fields.player_id);
          const discordId = toText(fields.discord_id).trim();
          if (!playerId || !discordId) {
            note(`Title ${title.code}: every fixed player needs "player_id" and "discord_id".`);
            continue;
          }
          const exists = sources.playerIds.has(playerId);
          const stored = sources.discordIds.get(playerId) ?? "";
          if (!exists || stored !== discordId) {
            const reason = exists ? `it has ${stored || "none"}` : "no such player";
            note(
              `Title ${title.code}: player ${playerId} is not Discord account ${discordId} (${reason}), so it awards nothing.`,
            );
            continue;
          }
          grant(playerId, title.code, "MANUAL", `Fixed: player ${playerId}, Discord ${discordId}`);
        }
        break;
      }
      case TEMPLATE_RULE_KIND:
      case "tournament-name": {
        const template = title.ruleKind === TEMPLATE_RULE_KIND;
        const listed = Array.isArray(params.names)
          ? (params.names as unknown[]).map(normalizeText).filter(Boolean)
          : null;
        if (!listed || (!listed.length && !template)) {
          note(`Title ${title.code}: RuleParams need "names".`);
          break;
        }
        if (!listed.length) {
          note(`Title ${title.code}: no tournament named yet, so ${name} waits for staff.`);
          break;
        }
        const names = new Set(listed.map((entry) => entry.toLowerCase()));
        for (const tournament of tournaments) {
          if (!names.has(tournament.name.toLowerCase()) || !inGame(tournament, game)) continue;
          const winners = tournament.isComplete ? recordedWinners(tournament) : null;
          if (!winners) {
            const reason = tournament.isComplete ? "no winner recorded" : "not completed";
            note(`${label(tournament)}: ${reason}, so it awards ${name} to nobody.`);
            continue;
          }
          let code = title.code;
          if (template) {
            // The template awards its variant of the tournament's game, created when it is missing.
            const variantGame = gameByType(tournament.gameType);
            if (!variantGame) {
              note(`${label(tournament)}: not one game, so it awards ${name} to nobody until staff decide.`);
              continue;
            }
            code = `${title.code}-${variantGame.suffix}`;
            const usable = ensureTitle({
              code,
              name,
              category: title.category,
              sortOrder: title.sortOrder,
              ruleKind: "tournament-name",
              ruleParams: JSON.stringify({ names: listed }),
              gameCode: variantGame.code,
            });
            if (!usable) continue;
          }
          for (const playerId of winners)
            grant(playerId, code, "ACCOLADE", `Tournament:${tournament.id} ${tournament.name}`);
        }
        break;
      }
      case "world-championship-count":
      case "side-tournament-count": {
        const min = positiveInt(params.min);
        if (!min) {
          note(`Title ${title.code}: RuleParams need "min".`);
          break;
        }
        const championships = title.ruleKind === "world-championship-count";
        const allWins = championships ? championshipWins() : tournamentWins();
        const wins = [...allWins].map(([playerId, won]) => [playerId, won.filter((t) => inGame(t, game))] as const);
        const what = championships ? "MSL World Championship" : "non-MSL tournament win";
        const where = game ? ` in ${game.code}` : "";
        for (const [playerId, won] of wins.sort((a, b) => a[0] - b[0])) {
          if (won.length < min) continue;
          // The tournaments that made the count reach `min`.
          const ids = won.slice(0, min).map((tournament) => tournament.id);
          const source = `Tournaments:${ids.join(",")} (${min} ${what}${min === 1 ? "" : "s"}${where})`;
          grant(playerId, title.code, championships ? "ACCOLADE" : "TOURNAMENT", source);
        }
        break;
      }
      case "legacy-rank": {
        if (!sources.legacyRanks) break;
        const tier = positiveInt(params.tier);
        if (!tier) {
          note(`Title ${title.code}: RuleParams need "tier".`);
          break;
        }
        for (const [playerId, best] of [...bestLegacyRanks(sources.legacyRanks)].sort((a, b) => a[0] - b[0])) {
          if (best.tier !== tier) continue;
          const { gameType, mode, rank } = best.row;
          grant(
            playerId,
            title.code,
            "LEGACY_RANK",
            `PlayerStats:${gameByType(gameType)?.code ?? gameType} ${mode} rank ${rank}`,
          );
        }
        break;
      }
      default:
        note(`Title ${title.code}: unknown rule kind "${title.ruleKind}", so it awards nothing.`);
    }
  }

  // Season titles: one per season and game that ended with at least one Strikers Titan. A season title
  // without a game (one staff added before 2026-10-02) stands for every game of its season.
  const seasonTitles = new Map<string, CatalogTitle>();
  for (const title of sources.catalog) {
    if (title.ruleKind !== "season-titan") continue;
    try {
      const seasonId = positiveInt((JSON.parse(title.ruleParams || "{}") as Record<string, unknown>).season_id);
      if (seasonId) seasonTitles.set(`${seasonId}|${title.gameCode}`, title);
      else note(`Title ${title.code}: RuleParams need "season_id".`);
    } catch {
      note(`Title ${title.code}: RuleParams is no JSON object, so it awards nothing.`);
    }
  }
  const completed = new Map(sources.seasons.filter((season) => season.status === "completed").map((s) => [s.id, s]));
  const titans = new Map<string, { seasonId: number; game: TitleGame; players: Set<number> }>();
  for (const row of sources.titans) {
    if (!completed.has(row.seasonId)) continue;
    const titanGame = gameByType(row.gameType);
    if (!titanGame) {
      note(`Season ${row.seasonId}: Strikers Titan ${row.playerId} in ${gameLabel(row.gameType)} is in no known game.`);
      continue;
    }
    const key = `${String(row.seasonId).padStart(6, "0")}|${titanGame.gameType}`;
    const entry = titans.get(key) ?? { seasonId: row.seasonId, game: titanGame, players: new Set<number>() };
    entry.players.add(row.playerId);
    titans.set(key, entry);
  }
  for (const [, { seasonId, game: titanGame, players }] of [...titans].sort((a, b) => a[0].localeCompare(b[0]))) {
    const season = completed.get(seasonId);
    if (!season) continue;
    const existing = seasonTitles.get(`${seasonId}|${titanGame.code}`) ?? seasonTitles.get(`${seasonId}|`);
    if (existing && !existing.isActive) continue;
    const code = existing?.code ?? `season-titan-${seasonId}-${titanGame.suffix}`;
    if (!existing) {
      ensureTitle({
        code,
        name: seasonTitanTitleName(season.displayName),
        category: TITLE_CATEGORY.season,
        sortOrder: season.seasonNumber,
        ruleKind: "season-titan",
        ruleParams: JSON.stringify({ season_id: seasonId }),
        gameCode: titanGame.code,
      });
    }
    for (const playerId of [...players].sort((a, b) => a - b)) {
      if (!sources.playerIds.has(playerId)) {
        note(`Season ${seasonId}: Strikers Titan ${playerId} is no player.`);
        continue;
      }
      grant(playerId, code, "SEASON", `CompetitiveSeason:${seasonId} ${season.displayName}`);
    }
  }

  return { newTitles, grants, openPoints };
}
