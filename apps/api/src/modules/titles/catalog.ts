// The player titles of the owner's title list (ms-titles.xlsx, October 2026): the categories and every
// title with its stable code and the rule that awards it. `npm run ops:player-titles` writes the ones the
// database does not have yet; from then on dbo.PlayerTitle is the source, so a title can be added there
// without a release (docs/adr/0008-player-titles.md). A code never changes once it is in the database.

import type { CatalogTitle } from "./availability.ts";

/** How a title is awarded; rules.ts describes each kind and its parameters. */
export type TitleRuleKind =
  | "everyone"
  | "manual"
  | "season-titan"
  | "tournament-name"
  | "world-championship-count"
  | "side-tournament-count"
  | "legacy-rank";

export interface TitleCategoryDefinition {
  readonly code: string;
  readonly name: string;
  /** Who can have its titles, as the title list says. */
  readonly availability: string;
  /** Every player has every title of the category, without unlock rows. */
  readonly isGlobal: boolean;
  /** Order of the groups in the profile's title list. */
  readonly sortOrder: number;
}

export interface TitleRule {
  readonly ruleKind: TitleRuleKind;
  readonly ruleParams?: Readonly<Record<string, unknown>>;
  /** A look for the later formatting (the green TOURNAMENT WINNER). */
  readonly styleKey?: string;
  /** Titles of one group: a player is offered only the highest level unlocked. */
  readonly exclusiveGroup?: string;
  readonly exclusiveLevel?: number;
}

export interface TitleDefinition extends TitleRule {
  readonly code: string;
  /** FULL CAPS, as the title list writes it. */
  readonly name: string;
  readonly category: string;
  readonly sortOrder: number;
}

export const TITLE_CATEGORIES: readonly TitleCategoryDefinition[] = [
  { code: "msl", name: "MSL Titles", availability: "MSL titles", isGlobal: false, sortOrder: 1 },
  {
    code: "competitive-season",
    name: "Competitive Season Titles",
    availability: "Only Striker Titans during a season",
    isGlobal: false,
    sortOrder: 2,
  },
  {
    code: "tournament",
    name: "Tournament Titles",
    availability: "Tournament winners (only certain, non-MSL)",
    isGlobal: false,
    sortOrder: 3,
  },
  {
    code: "special-pre-2014",
    name: "Special pre-2014 Titles",
    availability: "Special titles",
    isGlobal: false,
    sortOrder: 4,
  },
  {
    code: "legacy-rank",
    name: "Legacy Ranks",
    availability: "Old Legacy Titles (only certain)",
    isGlobal: false,
    sortOrder: 5,
  },
  { code: "free", name: "Free Titles", availability: "Everyone", isGlobal: true, sortOrder: 6 },
];

const EVERYONE: TitleRule = { ruleKind: "everyone" };
const MANUAL: TitleRule = { ruleKind: "manual" };

const worldChampionships = (min: number): TitleRule => ({
  ruleKind: "world-championship-count",
  ruleParams: { min },
  exclusiveGroup: "msl-world-championships",
  exclusiveLevel: min,
});

/**
 * Winners of the tournaments with exactly these names, in any game. A split's title goes to the winners of
 * its main event (Amateur, Challenger, Division A, Consolation and Live Events do not count); a split
 * without one names none and waits for staff.
 */
const wonTournament = (...names: string[]): TitleRule =>
  names.length ? { ruleKind: "tournament-name", ruleParams: { names } } : MANUAL;

const tournamentWins = (min: number, styleKey?: string): TitleRule => ({
  ruleKind: "side-tournament-count",
  ruleParams: { min },
  ...(styleKey ? { styleKey } : {}),
  exclusiveGroup: "tournament-winner",
  exclusiveLevel: min,
});

const legacyRank = (tier: number): TitleRule => ({
  ruleKind: "legacy-rank",
  ruleParams: { tier },
  exclusiveGroup: "legacy-rank",
  exclusiveLevel: tier,
});

type Entry = readonly [code: string, name: string, rule: TitleRule];

function inCategory(category: string, entries: readonly Entry[]): TitleDefinition[] {
  return entries.map(([code, name, rule], index) => ({ code, name, category, sortOrder: index + 1, ...rule }));
}

/** Every title of the list; season titles are created when a season ends with a Strikers Titan (rules.ts). */
export const TITLE_CATALOG: readonly TitleDefinition[] = [
  ...inCategory("msl", [
    ["msl-5-time-world-champion", "5-TIME WORLD CHAMPION", worldChampionships(5)],
    ["msl-4-time-world-champion", "4-TIME WORLD CHAMPION", worldChampionships(4)],
    ["msl-3-time-world-champion", "3-TIME WORLD CHAMPION", worldChampionships(3)],
    ["msl-2-time-world-champion", "2-TIME WORLD CHAMPION", worldChampionships(2)],
    ["msl-season-1-world-champion", "MSL SEASON 1 WORLD CHAMPION", wonTournament("MSL Season 1 World Championship")],
    ["msl-2022-world-champion", "MSL 2022 WORLD CHAMPION", wonTournament("MSL 2022 World Championship")],
    ["msl-2023-world-champion", "MSL 2023 WORLD CHAMPION", wonTournament("MSL 2023 World Championship")],
    ["msl-2024-world-champion", "MSL 2024 WORLD CHAMPION", wonTournament("MSL 2024 World Championship")],
    ["msl-2025-world-champion", "MSL 2025 WORLD CHAMPION", wonTournament("MSL 2025 World Championship")],
    ["msl-2026-world-champion", "MSL 2026 WORLD CHAMPION", wonTournament("MSL 2026 World Championship")],
    ["msl-season-1-spring-champion", "MSL SEASON 1 SPRING CHAMPION", wonTournament("MSL Season 1 Spring Split")],
    ["msl-season-1-summer-champion", "MSL SEASON 1 SUMMER CHAMPION", wonTournament("MSL Season 1 Summer Split")],
    ["msl-season-1-fall-champion", "MSL SEASON 1 FALL CHAMPION", wonTournament("MSL Season 1 Fall Split")],
    ["msl-2022-spring-champion", "MSL 2022 SPRING CHAMPION", wonTournament("MSL 2022 Spring Split")],
    ["msl-2022-summer-champion", "MSL 2022 SUMMER CHAMPION", wonTournament("MSL 2022 Summer Split")],
    ["msl-2022-fall-champion", "MSL 2022 FALL CHAMPION", wonTournament("MSL 2022 Fall Split")],
    ["msl-2023-spring-champion", "MSL 2023 SPRING CHAMPION", wonTournament("MSL 2023 Spring Split")],
    ["msl-2023-summer-champion", "MSL 2023 SUMMER CHAMPION", wonTournament("MSL 2023 Summer Split - Premier Event")],
    ["msl-2023-fall-champion", "MSL 2023 FALL CHAMPION", wonTournament("MSL 2023 Fall Split - Premier Event")],
    ["msl-2024-spring-champion", "MSL 2024 SPRING CHAMPION", wonTournament("MSL 2024 Spring Split - Premier Event")],
    ["msl-2024-summer-champion", "MSL 2024 SUMMER CHAMPION", wonTournament("MSL 2024 Summer Split - Premier Event")],
    ["msl-2024-fall-champion", "MSL 2024 FALL CHAMPION", wonTournament("MSL 2024 Fall Split - Premier Event")],
    ["msl-2025-spring-champion", "MSL 2025 SPRING CHAMPION", wonTournament()],
    ["msl-2025-summer-champion", "MSL 2025 SUMMER CHAMPION", wonTournament("MSL 2025 Summer Split - Premier Event")],
    ["msl-2025-fall-champion", "MSL 2025 FALL CHAMPION", wonTournament("MSL 2025 Fall Split - Premier Event")],
    ["msl-2026-spring-champion", "MSL 2026 SPRING CHAMPION", wonTournament("MSL 2026 Spring Series")],
    // Named like the 2026 Spring Series; they apply once such a tournament is entered.
    ["msl-2026-summer-champion", "MSL 2026 SUMMER CHAMPION", wonTournament("MSL 2026 Summer Series")],
    ["msl-2026-fall-champion", "MSL 2026 FALL CHAMPION", wonTournament("MSL 2026 Fall Series")],
  ]),
  ...inCategory("tournament", [
    ["tournament-winner", "TOURNAMENT WINNER", tournamentWins(1)],
    ["tournament-winner-green", "TOURNAMENT WINNER", tournamentWins(5, "green")],
  ]),
  // World records and final leaders of Nintendo Wi-Fi Connection (until 2014): staff only.
  ...inCategory("special-pre-2014", [
    ["wfc-200-0-season-world-record", "WFC 200-0 SEASON WORLD RECORD", MANUAL],
    ["wfc-66-0-daily-world-record", "WFC 66-0 DAILY WORLD RECORD", MANUAL],
    ["wfc-5012-daily-points-world-record", "WFC 5012 DAILY POINTS WORLD RECORD", MANUAL],
    ["wfc-final-daily-leader", "WFC FINAL DAILY LEADER", MANUAL],
    ["wfc-final-season-leader", "WFC FINAL SEASON LEADER", MANUAL],
  ]),
  ...inCategory("legacy-rank", [
    ["legacy-rookie", "LEGACY ROOKIE", legacyRank(1)],
    ["legacy-professional", "LEGACY PROFESSIONAL", legacyRank(2)],
    ["legacy-superstar", "LEGACY SUPERSTAR", legacyRank(3)],
    ["legacy-legend", "LEGACY LEGEND", legacyRank(4)],
    ["legacy-megastriker", "LEGACY MEGASTRIKER", legacyRank(5)],
  ]),
  ...inCategory("free", [
    ["super-mario-strikers-fan", "SUPER MARIO STRIKERS FAN", EVERYONE],
    ["mario-strikers-charged-fan", "MARIO STRIKERS CHARGED FAN", EVERYONE],
    ["mario-strikers-battle-league-fan", "MARIO STRIKERS: BATTLE LEAGUE FAN", EVERYONE],
    ["prefers-football-in-the-titles", 'PREFERS "FOOTBALL" IN THE TITLES', EVERYONE],
    ["kritter-over-boom-boom", "KRITTER>BOOM BOOM", EVERYONE],
    ["boom-boom-under-kritter", "BOOM BOOM<KRITTER", EVERYONE],
    ["crotch-chop-celebration", "CROTCH CHOP CELEBRATION!", EVERYONE],
    ["prefers-casual-play", "PREFERS CASUAL PLAY", EVERYONE],
    ["ultimate-swt", "ULTIMATE SWT.", EVERYONE],
    ["clip-farmer", "CLIP FARMER", EVERYONE],
    ["always-lfg", "ALWAYS LFG", EVERYONE],
    ["og-player", "OG PLAYER", EVERYONE],
    ["cant-win-tournaments", "CAN'T WIN TOURNAMENTS", EVERYONE],
    ["self-proclaimed-king-of-strikers", "SELF-PROCLAIMED KING OF STRIKERS", EVERYONE],
    ["toad-self-passer", "TOAD SELF PASSER", EVERYONE],
    ["hates-striker-challenge-8", "HATES STRIKER CHALLENGE #8", EVERYONE],
    ["mario-strikers-better-league", "MARIO STRIKERS: BETTER LEAGUE", EVERYONE],
    ["confirms", "CONFIRMS!", EVERYONE],
    ["three-ghosts", "3 GHOSTS", EVERYONE],
    ["full-trickster", "FULL TRICKSTER", EVERYONE],
    ["npc", "NPC", EVERYONE],
    ["football-is-life", "FOOTBALL IS LIFE", EVERYONE],
    ["wins-without-a-goalie", "WINS WITHOUT A GOALIE", EVERYONE],
  ]),
];

/** The catalog as the database holds it after ops:player-titles (ids in list order), for fixtures and tests. */
export function seededCatalog(): CatalogTitle[] {
  const categories = new Map(TITLE_CATEGORIES.map((category) => [category.code, category]));
  return TITLE_CATALOG.map((title, index) => {
    const category = categories.get(title.category);
    return {
      id: index + 1,
      code: title.code,
      name: title.name,
      category: title.category,
      categoryName: category?.name ?? title.category,
      categorySort: category?.sortOrder ?? 0,
      isGlobal: category?.isGlobal ?? false,
      sortOrder: title.sortOrder,
      ruleKind: title.ruleKind,
      ruleParams: title.ruleParams ? JSON.stringify(title.ruleParams) : "",
      styleKey: title.styleKey ?? "",
      exclusiveGroup: title.exclusiveGroup ?? "",
      exclusiveLevel: title.exclusiveLevel ?? 0,
      isActive: true,
    };
  });
}
