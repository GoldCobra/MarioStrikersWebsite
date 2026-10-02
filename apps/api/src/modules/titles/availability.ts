// Which titles a player can select: every active title of a global category (the Free Titles) and every
// active title unlocked for them, but of an exclusive group (legacy ranks, N-TIME WORLD CHAMPION,
// TOURNAMENT WINNER) only the highest level they unlocked. The profile, the editor and the fixtures all
// use this one definition.

import { normalizeText, toText } from "@ms/shared/text";

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

function compareTitles(a: CatalogTitle, b: CatalogTitle): number {
  return a.categorySort - b.categorySort || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

/** The titles the player can select, in the order of the list: by category, then by the title's place. */
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
