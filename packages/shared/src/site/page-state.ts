// Where a page sits in the navigation: its top-level section, second-level item and leaf. The site
// generator renders the navigation, tabs and breadcrumbs from it; the rules match the former runtime
// navigation script exactly, including its fallbacks for pages outside the explicit map.

import {
  PAGE_CONTEXT_MAP,
  SECTION_MODELS,
  type NavLeaf,
  type NavSecond,
  type NavSection,
  type TopNavKey,
} from "./navigation.ts";
import { ADMIN_PAGE, NOT_FOUND_PAGE, findPage, isIndexable, pagePath } from "./pages.ts";
import { SITE_ORIGIN } from "./site.ts";

export interface PageState {
  readonly pageSlug: string;
  /** "" only for the not-found page. */
  readonly topKey: TopNavKey | "";
  readonly section: NavSection | null;
  readonly secondItem: NavSecond | null;
  readonly leafItem: NavLeaf | null;
}

export interface BreadcrumbItem {
  readonly "@type": "ListItem";
  readonly position: number;
  readonly name: string;
  readonly item: string;
}

type SectionKey = keyof typeof SECTION_MODELS;

function isSectionKey(key: string): key is SectionKey {
  return Object.hasOwn(SECTION_MODELS, key);
}

export function sectionFor(topKey: TopNavKey | ""): NavSection | null {
  return topKey !== "" && isSectionKey(topKey) ? SECTION_MODELS[topKey] : null;
}

export function childMatchesPage(child: NavLeaf, slug: string): boolean {
  return child.slug === slug || (child.matchSlugs ?? []).includes(slug);
}

function stateFromMap(pageSlug: string): PageState | null {
  const entry = Object.hasOwn(PAGE_CONTEXT_MAP, pageSlug) ? PAGE_CONTEXT_MAP[pageSlug] : undefined;
  const section = entry ? sectionFor(entry.topKey) : null;
  if (!entry || !section) return null;
  const secondItem = entry.secondKey ? section.items.find((item) => item.key === entry.secondKey) : undefined;
  if (entry.secondKey && !secondItem) return null;
  const leafItem = entry.leafKey ? secondItem?.children?.find((child) => child.key === entry.leafKey) : undefined;
  if (entry.leafKey && !leafItem) return null;
  return { pageSlug, topKey: entry.topKey, section, secondItem: secondItem ?? null, leafItem: leafItem ?? null };
}

export function resolvePageState(pageSlug: string): PageState {
  const empty = { pageSlug, section: null, secondItem: null, leafItem: null };
  // The not-found and the admin page belong to no section, so no navigation entry is marked; neither does
  // the profile page, which the login button (the account) marks instead.
  if (pageSlug === NOT_FOUND_PAGE.slug || pageSlug === ADMIN_PAGE.slug || pageSlug === "profile") {
    return { ...empty, topKey: "" };
  }
  if (pageSlug === "index") return { ...empty, topKey: "home" };
  if (pageSlug === "partners") return { ...empty, topKey: "partners" };

  const mapped = stateFromMap(pageSlug);
  if (mapped) return mapped;

  for (const [topKey, section] of Object.entries(SECTION_MODELS) as [SectionKey, NavSection][]) {
    if (section.overviewSlug === pageSlug) return { ...empty, topKey, section };
    for (const item of section.items) {
      const leafItem = item.children?.find((child) => childMatchesPage(child, pageSlug));
      if (leafItem) return { pageSlug, topKey, section, secondItem: item, leafItem };
      if (item.slug === pageSlug) return { ...empty, topKey, section, secondItem: item };
    }
  }

  if (/^(?:msbl|msc|sms)/.test(pageSlug)) return { ...empty, topKey: "games", section: SECTION_MODELS.games };
  if (
    pageSlug.startsWith("msl") ||
    pageSlug.startsWith("community-tournaments") ||
    pageSlug.includes("competitiverules")
  ) {
    return { ...empty, topKey: "competitive", section: SECTION_MODELS.competitive };
  }
  if (pageSlug.startsWith("players-")) return { ...empty, topKey: "players", section: SECTION_MODELS.players };
  return { ...empty, topKey: "home" };
}

function absoluteUrl(slug: string): string {
  return SITE_ORIGIN + pagePath(slug);
}

/**
 * The BreadcrumbList entries of an indexable page; null for noindex pages. `pageLabel` is the page's
 * own name: its title up to the first "|".
 */
export function breadcrumbItems(state: PageState, pageLabel: string): BreadcrumbItem[] | null {
  const page = findPage(state.pageSlug);
  if (!page || !isIndexable(page)) return null;

  const items: BreadcrumbItem[] = [];
  const push = (name: string, slug: string): void => {
    const item = absoluteUrl(slug);
    if (items.at(-1)?.item === item) return;
    items.push({ "@type": "ListItem", position: items.length + 1, name, item });
  };

  push("Home", "index");
  if (state.pageSlug === "index") return items;
  if (state.topKey === "partners") {
    push("Partners", "partners");
    return items;
  }
  if (!state.section) {
    push(pageLabel, state.pageSlug);
    return items;
  }
  push(state.section.label, state.section.overviewSlug);
  if (state.secondItem) push(state.secondItem.label, state.secondItem.slug);
  if (state.leafItem) push(state.leafItem.label, state.leafItem.slug);
  if (items.at(-1)?.item !== absoluteUrl(state.pageSlug)) push(pageLabel, state.pageSlug);
  return items;
}

/** The part of a page title before " | Site name", as the breadcrumbs name the page. */
export function pageLabel(title: string): string {
  return title.split("|")[0]?.trim() || "Home";
}
