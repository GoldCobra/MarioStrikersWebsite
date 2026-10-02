// Which titles a player can select, and in which order: every active title of a global category (the Free
// Titles) and every active title unlocked for them, but of an exclusive group (legacy ranks, N-TIME WORLD
// CHAMPION) only the highest level they unlocked. The profile, the editor and the fixtures all use this
// one definition.

import { normalizeText, toText } from "@ms/shared/text";
import { TITLE_CATEGORY } from "./catalog.ts";

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
  readonly isActive: boolean;
}

/** A title as the profile editor offers it. */
export interface TitleOption {
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly categoryName: string;
  readonly style: string;
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
//   msl                 N-TIME WORLD CHAMPION first (5 down to 2), then by year, newest first (MSL SEASON 1
//                       is 2021), within a year WORLD CHAMPION, FALL, SUMMER, SPRING (the latest event first)
//   competitive-season  by year, newest first; within a year the later season (SortOrder = season number)
//   tournament          the green TOURNAMENT WINNER before the plain one
//   legacy-rank         MEGASTRIKER down to ROOKIE
//   free                A-Z
//   any other           its place in the list (SortOrder)
// Equal ranks fall back to the code, so the order never depends on how the database returns the rows.

type SortKey = readonly (number | string)[];

const N_TIME_WORLD_CHAMPION = /^(\d+)-TIME WORLD CHAMPION$/;
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
  switch (title.category) {
    case TITLE_CATEGORY.msl: {
      const times = N_TIME_WORLD_CHAMPION.exec(name);
      if (times) return [0, -Number(times[1])];
      const event = MSL_EVENTS.findIndex((word) => name.includes(` ${word} `));
      return [1, -titleYear(name), event < 0 ? MSL_EVENTS.length : event, title.sortOrder];
    }
    case TITLE_CATEGORY.season:
      return [-titleYear(name), -title.sortOrder];
    case TITLE_CATEGORY.tournament:
      return [title.styleKey === "green" ? 0 : 1, title.sortOrder];
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

/** The titles the player can select, in the order of the list (compareTitles). */
export function availableTitles(catalog: readonly CatalogTitle[], unlockedIds: Iterable<number>): CatalogTitle[] {
  const unlocked = new Set(unlockedIds);
  const candidates = catalog.filter((title) => title.isActive && (title.isGlobal || unlocked.has(title.id)));
  const highest = new Map<string, number>();
  for (const title of candidates) {
    if (!title.exclusiveGroup) continue;
    highest.set(title.exclusiveGroup, Math.max(highest.get(title.exclusiveGroup) ?? -Infinity, title.exclusiveLevel));
  }
  return candidates
    .filter((title) => !title.exclusiveGroup || title.exclusiveLevel === highest.get(title.exclusiveGroup))
    .sort(compareTitles);
}

/** The selected title while the player can still select it; null when none is selected or it is gone. */
export function selectedTitle(
  catalog: readonly CatalogTitle[],
  unlockedIds: Iterable<number>,
  selectedId: number | null,
): CatalogTitle | null {
  if (selectedId === null) return null;
  return availableTitles(catalog, unlockedIds).find((title) => title.id === selectedId) ?? null;
}

export function toTitleOption(title: CatalogTitle): TitleOption {
  return {
    code: title.code,
    name: titleText(title.name),
    category: title.category,
    categoryName: title.categoryName,
    style: title.styleKey,
  };
}
