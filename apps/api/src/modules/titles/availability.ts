// Which titles a player can select, and in which order: every active title of a global category (the Free
// Titles) and every active title unlocked for them, but of an exclusive group (legacy ranks, N-TIME WORLD
// CHAMPION of a game) only the highest level they unlocked. An MSL event template is never offered (its
// game variants are), and a fixed title only to the players it belongs to. Test unlocks
// (dbo.PlayerTitleTestUnlock) add titles on top, every level of a group included; they change nothing
// else. The profile, the editor and the fixtures all use this one definition.

import { normalizeText, toText } from "@ms/shared/text";
import { TEMPLATE_RULE_KIND, TITLE_CATEGORY } from "./catalog.ts";
import { gameRank, type TitleGameCode } from "./games.ts";

/** A dbo.PlayerTitle row with its category, as the catalog query reads it. */
export interface CatalogTitle {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly categoryName: string;
  readonly categorySort: number;
  readonly isGlobal: boolean;
  readonly sortOrder: number;
  readonly ruleKind: string;
  /** RuleParams as stored: JSON text, "" for none. */
  readonly ruleParams: string;
  readonly styleKey: string;
  readonly exclusiveGroup: string;
  readonly exclusiveLevel: number;
  /** The game the title belongs to (its ball icon); "" for none. */
  readonly gameCode: TitleGameCode | "";
  readonly isActive: boolean;
}

/** A title as the profile editor offers it. */
export interface TitleOption {
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly categoryName: string;
  /** Its look (titleLook): the colour and glow the profile's title list shows it in. */
  readonly style: string;
  /** Its game ("MSBL", "MSC", "SMS"), shown as the game's ball before the name; "" for none. */
  readonly gameCode: TitleGameCode | "";
}

/** Whose titles to offer: the player (fixed titles) and their test unlocks. */
export interface TitleHolder {
  readonly playerId?: number | null;
  /** dbo.PlayerTitleTestUnlock: temporary, kept apart from the regular unlocks. */
  readonly testUnlockedIds?: Iterable<number>;
}

/** A title as it is shown: trimmed and in FULL CAPS (the database allows nothing else; this is a second guard). */
export function titleText(name: unknown): string {
  return normalizeText(name).toUpperCase();
}

/** A title code as the API takes it: trimmed, lower case. */
export function normalizeTitleCode(code: unknown): string {
  return toText(code).trim().toLowerCase();
}

// The order of the title list (owner, 2026-10-02). Categories by their SortOrder, the global one (Free
// Titles) always last, so a new category falls in before it. Inside a category by its own rule:
//   msl                 in groups: X-TIME WORLD CHAMPION (5 down to 2), WORLD CHAMPION, FALL, SUMMER, SPRING
//                       CHAMPION; within a group by year, newest first (MSL SEASON 1 is 2021)
//   competitive-season  by year, newest first; within a year the later season (SortOrder = season number)
//   tournament          the green TOURNAMENT WINNER before the plain one
//   legacy-rank         MEGASTRIKER down to ROOKIE
//   free                A-Z
//   any other           its place in the list (SortOrder)
// Titles that differ only in their game follow the site's game order (MSBL, MSC, SMS; games.ts). Equal
// ranks fall back to the code, so the order never depends on how the database returns the rows.

type SortKey = readonly (number | string)[];

const N_TIME_WORLD_CHAMPION = /^(\d+)-TIME WORLD CHAMPION$/;
/** The MSL groups after X-TIME, in the owner's order; a title naming none of them comes after them. */
const MSL_EVENTS = ["WORLD", "FALL", "SUMMER", "SPRING"];

/** The year a title names; MSL SEASON <n> counts from 2021 (Season 1); 0 when it names none. */
export function titleYear(name: string): number {
  const year = /\b(?:19|20)\d{2}\b/.exec(name);
  if (year) return Number(year[0]);
  const season = /\bSEASON (\d+)\b/.exec(name);
  return season ? 2020 + Number(season[1]) : 0;
}

function categoryKey(title: CatalogTitle): SortKey {
  return [title.isGlobal ? 1 : 0, title.categorySort, title.category];
}

function titleKey(title: CatalogTitle): SortKey {
  const name = titleText(title.name);
  const game = gameRank(title.gameCode);
  switch (title.category) {
    case TITLE_CATEGORY.msl: {
      const times = N_TIME_WORLD_CHAMPION.exec(name);
      if (times) return [0, -Number(times[1]), game, title.sortOrder];
      const event = MSL_EVENTS.findIndex((word) => name.includes(` ${word} `));
      return [1 + (event < 0 ? MSL_EVENTS.length : event), -titleYear(name), game, title.sortOrder];
    }
    case TITLE_CATEGORY.season:
      return [-titleYear(name), -title.sortOrder, game];
    case TITLE_CATEGORY.tournament:
      return [title.styleKey === "green" ? 0 : 1, game, title.sortOrder];
    case TITLE_CATEGORY.legacy:
      return [-title.exclusiveLevel, -title.sortOrder];
    case TITLE_CATEGORY.free:
      return [name];
    default:
      return [title.sortOrder];
  }
}

function compareKeys(a: SortKey, b: SortKey): number {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] ?? "";
    const right = b[index] ?? "";
    const difference =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right), "en", { sensitivity: "base", numeric: true });
    if (difference) return difference;
  }
  return 0;
}

export function compareTitles(a: CatalogTitle, b: CatalogTitle): number {
  return (
    compareKeys(categoryKey(a), categoryKey(b)) ||
    compareKeys(titleKey(a), titleKey(b)) ||
    compareKeys([a.code], [b.code])
  );
}

/** An MSL event template (RuleKind msl-event): only its game variants can be selected. */
export function isTemplateTitle(title: Pick<CatalogTitle, "ruleKind">): boolean {
  return title.ruleKind === TEMPLATE_RULE_KIND;
}

/** The players a fixed title belongs to (RuleKind fixed-players); null for any other title. */
export function fixedTitleOwners(title: Pick<CatalogTitle, "ruleKind" | "ruleParams">): ReadonlySet<number> | null {
  if (title.ruleKind !== "fixed-players") return null;
  try {
    const params = JSON.parse(title.ruleParams || "{}") as { players?: unknown };
    const players = Array.isArray(params.players) ? (params.players as unknown[]) : [];
    return new Set(
      players
        .map((player) => Number((player as { player_id?: unknown } | null)?.player_id))
        .filter((id) => Number.isInteger(id) && id > 0),
    );
  } catch {
    return new Set();
  }
}

/** Selectable at all: active and no template. */
function isOffered(title: CatalogTitle): boolean {
  return title.isActive && !isTemplateTitle(title);
}

/** The titles the player can select, in the order of the list (compareTitles). */
export function availableTitles(
  catalog: readonly CatalogTitle[],
  unlockedIds: Iterable<number>,
  holder: TitleHolder = {},
): CatalogTitle[] {
  const unlocked = new Set(unlockedIds);
  const ownedBy = (title: CatalogTitle): boolean => {
    const owners = fixedTitleOwners(title);
    return !owners || (holder.playerId !== null && holder.playerId !== undefined && owners.has(holder.playerId));
  };
  const regular = catalog.filter(
    (title) => isOffered(title) && (title.isGlobal || (unlocked.has(title.id) && ownedBy(title))),
  );
  const highest = new Map<string, number>();
  for (const title of regular) {
    if (!title.exclusiveGroup) continue;
    highest.set(title.exclusiveGroup, Math.max(highest.get(title.exclusiveGroup) ?? -Infinity, title.exclusiveLevel));
  }
  const offered = new Map(
    regular
      .filter((title) => !title.exclusiveGroup || title.exclusiveLevel === highest.get(title.exclusiveGroup))
      .map((title) => [title.id, title]),
  );
  // Test unlocks: every level, also of another player's fixed title (a temporary, explicit exception).
  const tested = new Set(holder.testUnlockedIds ?? []);
  for (const title of catalog) {
    if (tested.has(title.id) && isOffered(title) && !offered.has(title.id)) offered.set(title.id, title);
  }
  return [...offered.values()].sort(compareTitles);
}

/** The selected title while the player can still select it; null when none is selected or it is gone. */
export function selectedTitle(
  catalog: readonly CatalogTitle[],
  unlockedIds: Iterable<number>,
  selectedId: number | null,
  holder: TitleHolder = {},
): CatalogTitle | null {
  if (selectedId === null) return null;
  return availableTitles(catalog, unlockedIds, holder).find((title) => title.id === selectedId) ?? null;
}

/**
 * How a title looks (owner, 2026-10-02): its colour and glow, by its group. The popup, the Discord card and
 * the profile's title list all show this one look; their colours live once in styles/player-popup.css.
 *   free, tournament, legacy  #b6b6b6
 *   season                    #ff0000 with glow
 *   special                   #aef7ff with glow
 *   msl-world                 #ffeb5c with glow (every MSL title naming WORLD CHAMPION, N-TIME included)
 *   msl                       #e09e00 (the SPRING, SUMMER and FALL CHAMPION titles)
 *   tournament-x5             #77c300 (the green TOURNAMENT WINNER, style key "green")
 *   plain                     a category without a look of its own, like the Free Titles
 */
export type TitleLook =
  "free" | "season" | "special" | "msl-world" | "msl" | "tournament" | "tournament-x5" | "legacy" | "plain";

export function titleLook(title: Pick<CatalogTitle, "category" | "name" | "styleKey">): TitleLook {
  switch (title.category) {
    case TITLE_CATEGORY.free:
      return "free";
    case TITLE_CATEGORY.season:
      return "season";
    case TITLE_CATEGORY.special:
      return "special";
    case TITLE_CATEGORY.msl:
      return titleText(title.name).includes("WORLD CHAMPION") ? "msl-world" : "msl";
    case TITLE_CATEGORY.tournament:
      return title.styleKey === "green" ? "tournament-x5" : "tournament";
    case TITLE_CATEGORY.legacy:
      return "legacy";
    default:
      return "plain";
  }
}

export function toTitleOption(title: CatalogTitle): TitleOption {
  return {
    code: title.code,
    name: titleText(title.name),
    category: title.category,
    categoryName: title.categoryName,
    style: titleLook(title),
    gameCode: title.gameCode,
  };
}
