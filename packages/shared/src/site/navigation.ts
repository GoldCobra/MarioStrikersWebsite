// Navigation model shared by the page generator and the route checks. Values were taken verbatim
// from the former runtime navigation script so the rendered markup stays identical.

export type TopNavKey = "home" | "games" | "competitive" | "players" | "partners";

export interface ExternalLink {
  readonly label: string;
  readonly href: string;
}

export interface TopNavItem {
  readonly key: TopNavKey;
  readonly label: string;
  readonly slug: string;
}

export interface NavLeaf {
  readonly key: string;
  readonly label: string;
  readonly slug: string;
  /** Hidden leaves keep their page but get no tab. */
  readonly hidden?: boolean;
  /** Further slugs that mark this leaf as active (e.g. the WHR tab of a leaderboard). */
  readonly matchSlugs?: readonly string[];
}

export interface NavSecond {
  readonly key: string;
  readonly label: string;
  /** Upper-case label for the second-level strip, when it differs from the tab label. */
  readonly subnavLabel?: string;
  readonly slug: string;
  readonly children?: readonly NavLeaf[];
}

export interface NavSection {
  readonly overviewSlug: string;
  readonly label: string;
  readonly items: readonly NavSecond[];
}

export interface PageContext {
  readonly topKey: TopNavKey;
  readonly secondKey?: string;
  readonly leafKey?: string;
}

export const EXTERNAL_LINKS: readonly ExternalLink[] = [
  {
    label: "Discord",
    href: "https://discord.gg/de2YaWg",
  },
  {
    label: "X",
    href: "https://x.com/MarioStrikersGG",
  },
  {
    label: "YouTube",
    href: "https://www.youtube.com/@MarioStrikersGG",
  },
  {
    label: "Twitch",
    href: "https://twitch.tv/MarioStrikersGG",
  },
];

export const TOP_NAV_ITEMS: readonly TopNavItem[] = [
  {
    key: "home",
    label: "Home",
    slug: "index",
  },
  {
    key: "games",
    label: "Games",
    slug: "games",
  },
  {
    key: "competitive",
    label: "Competitive",
    slug: "competitive",
  },
  {
    key: "players",
    label: "Players",
    slug: "players",
  },
  {
    key: "partners",
    label: "Partners",
    slug: "partners",
  },
];

export const SECTION_MODELS: Readonly<Record<"games" | "competitive" | "players", NavSection>> = {
  games: {
    overviewSlug: "games",
    label: "Games",
    items: [
      {
        key: "msbl",
        label: "MSBL",
        subnavLabel: "STRIKERS: BATTLE LEAGUE",
        slug: "msbl",
        children: [
          {
            key: "striker-clubs",
            label: "Striker Clubs",
            slug: "msbl-striker-clubs",
          },
          {
            key: "gear-builder",
            label: "Gear Builder",
            slug: "msbl-gear-builder",
          },
          {
            key: "save-editor",
            label: "Save Editor",
            slug: "msbl-save-editor",
          },
        ],
      },
      {
        key: "msc",
        label: "MSC",
        subnavLabel: "STRIKERS CHARGED",
        slug: "msc",
        children: [
          {
            key: "setup-guide",
            label: "Setup Guide",
            slug: "msc-setup-guide",
          },
          {
            key: "save-editor",
            label: "Save Editor",
            slug: "msc-save-editor",
          },
          {
            key: "wiimmfi",
            label: "WIIMMFI",
            slug: "msc-wiimmfi",
            hidden: true,
          },
        ],
      },
      {
        key: "sms",
        label: "SMS",
        subnavLabel: "SUPER MARIO STRIKERS",
        slug: "sms",
        children: [
          {
            key: "setup-guide",
            label: "Setup Guide",
            slug: "sms-setup-guide",
          },
        ],
      },
    ],
  },
  competitive: {
    overviewSlug: "competitive",
    label: "Competitive",
    items: [
      {
        key: "rules",
        label: "Rules",
        slug: "competitive-rules",
        children: [
          {
            key: "msbl-rules",
            label: "MSBL",
            slug: "msbl-competitiverules",
          },
          {
            key: "msc-rules",
            label: "MSC",
            slug: "msc-competitiverules",
          },
          {
            key: "sms-rules",
            label: "SMS",
            slug: "sms-competitiverules",
          },
        ],
      },
      {
        key: "msl",
        label: "MSL",
        slug: "msl",
        children: [
          {
            key: "league-rules",
            label: "League Rules",
            slug: "msl-league-rules",
          },
          {
            key: "league-site",
            label: "Schedule",
            slug: "msl-schedule",
          },
        ],
      },
      {
        key: "tournaments",
        label: "Events",
        slug: "competitive-tournaments",
        children: [
          {
            key: "community",
            label: "Tournaments",
            slug: "community-tournaments",
          },
        ],
      },
      {
        key: "leaderboards",
        label: "Leaderboards",
        slug: "competitive-leaderboards",
        children: [
          {
            key: "msbl",
            label: "MSBL",
            slug: "msbl-elo1v1",
            matchSlugs: ["msbl-elo1v1", "msbl-elo2v2", "msbl-whr"],
          },
          {
            key: "msc",
            label: "MSC",
            slug: "msc-elo1v1",
            matchSlugs: ["msc-elo1v1", "msc-whr"],
          },
          {
            key: "sms",
            label: "SMS",
            slug: "sms-elo1v1",
            matchSlugs: ["sms-elo1v1", "sms-whr"],
          },
        ],
      },
      {
        key: "tier-lists",
        label: "Tier Lists",
        slug: "competitive-tier-lists",
        children: [
          {
            key: "msbl",
            label: "MSBL",
            slug: "msbl-tierlist",
          },
          {
            key: "msc",
            label: "MSC",
            slug: "msc-tierlist",
          },
          {
            key: "sms",
            label: "SMS",
            slug: "sms-tierlist",
          },
        ],
      },
    ],
  },
  players: {
    overviewSlug: "players",
    label: "Players",
    items: [],
  },
};

/** Explicit placement of pages below their top-level section. */
export const PAGE_CONTEXT_MAP: Readonly<Record<string, PageContext>> = {
  msbl: {
    topKey: "games",
    secondKey: "msbl",
  },
  "msbl-striker-clubs": {
    topKey: "games",
    secondKey: "msbl",
    leafKey: "striker-clubs",
  },
  "msbl-gear-builder": {
    topKey: "games",
    secondKey: "msbl",
    leafKey: "gear-builder",
  },
  "msbl-save-editor": {
    topKey: "games",
    secondKey: "msbl",
    leafKey: "save-editor",
  },
  msc: {
    topKey: "games",
    secondKey: "msc",
  },
  sms: {
    topKey: "games",
    secondKey: "sms",
  },
  "msc-setup-guide": {
    topKey: "games",
    secondKey: "msc",
    leafKey: "setup-guide",
  },
  "msc-save-editor": {
    topKey: "games",
    secondKey: "msc",
    leafKey: "save-editor",
  },
  "msc-wiimmfi": {
    topKey: "games",
    secondKey: "msc",
    leafKey: "wiimmfi",
  },
  "sms-setup-guide": {
    topKey: "games",
    secondKey: "sms",
    leafKey: "setup-guide",
  },
  "competitive-rules": {
    topKey: "competitive",
    secondKey: "rules",
  },
  "msbl-competitiverules": {
    topKey: "competitive",
    secondKey: "rules",
    leafKey: "msbl-rules",
  },
  "msc-competitiverules": {
    topKey: "competitive",
    secondKey: "rules",
    leafKey: "msc-rules",
  },
  "sms-competitiverules": {
    topKey: "competitive",
    secondKey: "rules",
    leafKey: "sms-rules",
  },
  msl: {
    topKey: "competitive",
    secondKey: "msl",
  },
  "msl-league-rules": {
    topKey: "competitive",
    secondKey: "msl",
    leafKey: "league-rules",
  },
  "msl-schedule": {
    topKey: "competitive",
    secondKey: "msl",
    leafKey: "league-site",
  },
  "competitive-leaderboards": {
    topKey: "competitive",
    secondKey: "leaderboards",
  },
  "msbl-elo1v1": {
    topKey: "competitive",
    secondKey: "leaderboards",
    leafKey: "msbl",
  },
  "msbl-elo2v2": {
    topKey: "competitive",
    secondKey: "leaderboards",
    leafKey: "msbl",
  },
  "msbl-whr": {
    topKey: "competitive",
    secondKey: "leaderboards",
    leafKey: "msbl",
  },
  "msc-elo1v1": {
    topKey: "competitive",
    secondKey: "leaderboards",
    leafKey: "msc",
  },
  "msc-whr": {
    topKey: "competitive",
    secondKey: "leaderboards",
    leafKey: "msc",
  },
  "sms-elo1v1": {
    topKey: "competitive",
    secondKey: "leaderboards",
    leafKey: "sms",
  },
  "sms-whr": {
    topKey: "competitive",
    secondKey: "leaderboards",
    leafKey: "sms",
  },
  "competitive-tier-lists": {
    topKey: "competitive",
    secondKey: "tier-lists",
  },
  "msbl-tierlist": {
    topKey: "competitive",
    secondKey: "tier-lists",
    leafKey: "msbl",
  },
  "msc-tierlist": {
    topKey: "competitive",
    secondKey: "tier-lists",
    leafKey: "msc",
  },
  "sms-tierlist": {
    topKey: "competitive",
    secondKey: "tier-lists",
    leafKey: "sms",
  },
  "competitive-tournaments": {
    topKey: "competitive",
    secondKey: "tournaments",
  },
  "community-tournaments": {
    topKey: "competitive",
    secondKey: "tournaments",
    leafKey: "community",
  },
  profile: {
    topKey: "players",
  },
};
