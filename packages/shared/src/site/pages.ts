// The single list of public pages. Head metadata, the sitemap, nginx routes and the checks all read it.
// The first entries were extracted from the hand-written page files; keep one entry per page file.

import { SITE_ORIGIN } from "./site.ts";

export type Robots = "noindex, follow" | "noindex, nofollow";
export type JsonLd = Readonly<Record<string, unknown>>;

export interface PageDefinition {
  /** URL slug; "index" is the home page at "/". */
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  /** Text of the visually hidden page heading; omitted when the page content has its own heading. */
  readonly hiddenHeading?: string;
  /** The page's name in breadcrumbs when it is not the part of the title before "|". */
  readonly breadcrumbName?: string;
  /** Omitted for indexable pages. */
  readonly robots?: Robots;
  readonly jsonLd?: readonly JsonLd[];
}

export const PAGES: readonly PageDefinition[] = [
  {
    slug: "index",
    title: "Mario Strikers Community: Rankings, Tournaments & Tools",
    description:
      "Fan-run Mario Strikers community with matches, tournaments, rankings, guides and tools for Mario Strikers: Battle League, Charged and Super Mario Strikers.",
    hiddenHeading: "Mario Strikers Community",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "WebSite",
            "@id": "https://mariostrikers.gg/#website",
            name: "Mario Strikers Community",
            url: "https://mariostrikers.gg/",
            inLanguage: "en-US",
            description:
              "Fan-run Mario Strikers community with matches, tournaments, rankings, guides and tools for Mario Strikers: Battle League, Charged and Super Mario Strikers.",
          },
          {
            "@type": "Organization",
            "@id": "https://mariostrikers.gg/#organization",
            name: "Mario Strikers Community",
            url: "https://mariostrikers.gg/",
            description:
              "A fan-run Mario Strikers community for matches, events, tournaments, and Mario Strikers League competition.",
            sameAs: [
              "https://discord.gg/de2YaWg",
              "https://x.com/MarioStrikersGG",
              "https://www.youtube.com/@MarioStrikersGG",
              "https://twitch.tv/MarioStrikersGG",
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "about-us",
    title: "About the Mario Strikers Community",
    description:
      "Learn about the fan-run Mario Strikers Community: regular matches, events and tournaments across all Mario Strikers games, and the Mario Strikers League.",
    breadcrumbName: "About Us",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        "@id": "https://mariostrikers.gg/#organization",
        name: "Mario Strikers Community",
        url: "https://mariostrikers.gg/",
        description:
          "A fan-run Mario Strikers community for matches, events, tournaments, and Mario Strikers League competition.",
        sameAs: [
          "https://discord.gg/de2YaWg",
          "https://x.com/MarioStrikersGG",
          "https://www.youtube.com/@MarioStrikersGG",
          "https://twitch.tv/MarioStrikersGG",
        ],
      },
    ],
  },
  {
    slug: "community-tournaments",
    title: "Tournaments | Mario Strikers Community",
    description: "Discover active community tournaments and events for the Mario Strikers player community.",
    robots: "noindex, follow",
  },
  {
    slug: "competitive",
    title: "Competitive | Mario Strikers Community",
    description:
      "Find competitive Mario Strikers resources, rules, leaderboards, tournaments, rankings, and tier lists for supported games.",
    hiddenHeading: "Competitive Mario Strikers",
    robots: "noindex, follow",
  },
  {
    slug: "competitive-leaderboards",
    title: "Competitive Leaderboards | Mario Strikers Community",
    description: "Choose a Mario Strikers leaderboard by tab.",
    hiddenHeading: "Competitive Leaderboards",
    robots: "noindex, follow",
  },
  {
    slug: "competitive-rules",
    title: "Competitive Rules | Mario Strikers Community",
    description: "Choose a Mario Strikers competitive ruleset by tab.",
    hiddenHeading: "Competitive Rules",
    robots: "noindex, follow",
  },
  {
    slug: "competitive-tier-lists",
    title: "Competitive Tier Lists | Mario Strikers Community",
    description: "Choose a Mario Strikers tier list by tab.",
    hiddenHeading: "Competitive Tier Lists",
    robots: "noindex, follow",
  },
  {
    slug: "competitive-tournaments",
    title: "Events | Mario Strikers Community",
    description: "Choose a Mario Strikers events destination by tab.",
    hiddenHeading: "Events",
    robots: "noindex, follow",
  },
  {
    slug: "games",
    title: "Games | Mario Strikers Community",
    description:
      "Explore Mario Strikers games supported by the community, including MSBL, MSC, SMS, and Mario Strikers League resources.",
    hiddenHeading: "Mario Strikers Games",
    robots: "noindex, follow",
  },
  {
    slug: "msbl",
    title: "MSBL | Mario Strikers Community",
    description: "Find MSBL resources, Striker Clubs, the Gear Builder, and local save editor tools.",
    hiddenHeading: "MSBL",
    robots: "noindex, follow",
  },
  {
    slug: "msbl-competitiverules",
    title: "Mario Strikers: Battle League Competitive Rules (MSBL)",
    description:
      "Competitive rules for Mario Strikers: Battle League (MSBL): match settings, stadiums, disconnections, stalling, conduct and penalties in community play.",
    hiddenHeading: "Mario Strikers: Battle League Competitive Rules",
  },
  {
    slug: "msbl-elo1v1",
    title: "Mario Strikers: Battle League 1v1 ELO Rankings (MSBL)",
    description:
      "Live 1v1 ELO leaderboard for Mario Strikers: Battle League (MSBL): ranks, ratings, wins and losses of the community's ranked players this season.",
    hiddenHeading: "Mario Strikers: Battle League 1v1 ELO Rankings",
  },
  {
    slug: "msbl-elo2v2",
    title: "Mario Strikers: Battle League 2v2 ELO Rankings (MSBL)",
    description:
      "Live 2v2 ELO leaderboard for Mario Strikers: Battle League (MSBL): ranks, ratings, wins and losses of the community's ranked doubles players this season.",
    hiddenHeading: "Mario Strikers: Battle League 2v2 ELO Rankings",
    breadcrumbName: "MSBL ELO 2v2",
  },
  {
    slug: "msbl-gear-builder",
    title: "Mario Strikers: Battle League Gear Builder (MSBL)",
    description:
      "Build and compare gear setups for every character in Mario Strikers: Battle League (MSBL) and see how each piece of gear changes their stats.",
    hiddenHeading: "Mario Strikers: Battle League Gear Builder",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "MSBL Gear Builder",
        url: "https://mariostrikers.gg/msbl-gear-builder",
        description:
          "Build and compare gear setups for every character in Mario Strikers: Battle League (MSBL) and see how each piece of gear changes their stats.",
        applicationCategory: "UtilitiesApplication",
        operatingSystem: "Web",
        isAccessibleForFree: true,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
      },
    ],
  },
  {
    slug: "msbl-save-editor",
    title: "Mario Strikers: Battle League Save Editor (MSBL)",
    description:
      "Edit Mario Strikers: Battle League (MSBL) save files in your browser: complete cups, unlock all gear, set coins and import gear presets. Nothing is uploaded.",
    hiddenHeading: "Mario Strikers: Battle League Save Editor",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "MSBL Save Editor",
        url: "https://mariostrikers.gg/msbl-save-editor",
        description:
          "Edit Mario Strikers: Battle League (MSBL) save files in your browser: complete cups, unlock all gear, set coins and import gear presets. Nothing is uploaded.",
        applicationCategory: "UtilitiesApplication",
        operatingSystem: "Web",
        isAccessibleForFree: true,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
      },
    ],
  },
  {
    slug: "msbl-striker-clubs",
    title: "Mario Strikers: Battle League Striker Clubs (MSBL)",
    description:
      "Browse the community's Striker Clubs for Mario Strikers: Battle League (MSBL): members, regions, club codes, join conditions and which clubs are open.",
    hiddenHeading: "Mario Strikers: Battle League Striker Clubs",
  },
  {
    slug: "msbl-tierlist",
    title: "Mario Strikers: Battle League Tier List (MSBL)",
    description:
      "The current competitive tier list for Mario Strikers: Battle League (MSBL), ranking the characters by their strength in the community's competitive play.",
    hiddenHeading: "Mario Strikers: Battle League Tier List",
  },
  {
    slug: "msbl-whr",
    title: "Mario Strikers: Battle League WHR Rankings (MSBL)",
    description:
      "All-time Whole History Rating (WHR) leaderboard for Mario Strikers: Battle League (MSBL), recalculated from every reported 1v1 result in the community.",
    hiddenHeading: "Mario Strikers: Battle League WHR Rankings",
    breadcrumbName: "MSBL WHR",
  },
  {
    slug: "msc",
    title: "MSC | Mario Strikers Community",
    description: "Find Mario Strikers Charged resources, setup guidance, rankings, rules, and community tools.",
    hiddenHeading: "MSC",
    robots: "noindex, follow",
  },
  {
    slug: "msc-competitiverules",
    title: "Mario Strikers Charged Competitive Rules (MSC)",
    description:
      "Competitive rules for Mario Strikers Charged (MSC): Dolphin Netplay settings, match settings, stadiums, disconnections, stalling, conduct and penalties.",
    hiddenHeading: "Mario Strikers Charged Competitive Rules",
  },
  {
    slug: "msc-elo1v1",
    title: "Mario Strikers Charged 1v1 ELO Rankings (MSC)",
    description:
      "Live 1v1 ELO leaderboard for Mario Strikers Charged (MSC): ranks, ratings, wins and losses of the community's ranked players in the current season.",
    hiddenHeading: "Mario Strikers Charged 1v1 ELO Rankings",
  },
  {
    slug: "msc-save-editor",
    title: "Mario Strikers Charged Save Editor (MSC)",
    description:
      "Edit Mario Strikers Charged (MSC) saves in your browser: build and share team presets, manage your online friend list and apply the competitive settings.",
    hiddenHeading: "Mario Strikers Charged Save Editor",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "MSC Save Editor",
        url: "https://mariostrikers.gg/msc-save-editor",
        description:
          "Edit Mario Strikers Charged (MSC) saves in your browser: build and share team presets, manage your online friend list and apply the competitive settings.",
        applicationCategory: "UtilitiesApplication",
        operatingSystem: "Web",
        isAccessibleForFree: true,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
      },
    ],
  },
  {
    slug: "msc-setup-guide",
    title: "Mario Strikers Charged Online Setup Guide (MSC)",
    description:
      "Play Mario Strikers Charged (MSC) online: set up Wii, Wii U or Dolphin with Wiimmfi and Netplay, controllers, graphics, Gecko codes and troubleshooting.",
    breadcrumbName: "MSC Setup Guide",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "TechArticle",
        headline: "Mario Strikers Charged Online Setup Guide",
        description:
          "Play Mario Strikers Charged (MSC) online: set up Wii, Wii U or Dolphin with Wiimmfi and Netplay, controllers, graphics, Gecko codes and troubleshooting.",
        url: "https://mariostrikers.gg/msc-setup-guide",
        inLanguage: "en-US",
        about: {
          "@type": "VideoGame",
          name: "Mario Strikers Charged",
          gamePlatform: "Wii",
        },
        publisher: {
          "@type": "Organization",
          name: "Mario Strikers Community",
          url: "https://mariostrikers.gg/",
        },
      },
    ],
  },
  {
    slug: "msc-tierlist",
    title: "Mario Strikers Charged Tier List (MSC)",
    description:
      "The current competitive tier list for Mario Strikers Charged (MSC), ranking the captains and sidekicks by their strength in the community's competitive play.",
    hiddenHeading: "Mario Strikers Charged Tier List",
  },
  {
    slug: "msc-whr",
    title: "Mario Strikers Charged WHR Rankings (MSC)",
    description:
      "All-time Whole History Rating (WHR) leaderboard for Mario Strikers Charged (MSC), recalculated from every reported 1v1 result in the community.",
    hiddenHeading: "Mario Strikers Charged WHR Rankings",
    breadcrumbName: "MSC WHR",
  },
  {
    slug: "msc-wiimmfi",
    title: "Mario Strikers Charged Online Players | Mario Strikers Community",
    description: "See who is playing Mario Strikers Charged (MSC) online on Wiimmfi right now.",
    hiddenHeading: "MSC WIIMMFI",
    robots: "noindex, follow",
  },
  {
    slug: "msl",
    title: "MSL | Mario Strikers Community",
    description: "Explore the Mario Strikers League hub for league rules, schedule information, and leaderboards.",
    hiddenHeading: "MSL",
    robots: "noindex, follow",
  },
  {
    slug: "msl-leaderboards",
    title: "MSL Leaderboards | Mario Strikers Community",
    description: "View Mario Strikers League leaderboards and competitive standings.",
    hiddenHeading: "MSL Leaderboards",
    robots: "noindex, follow",
  },
  {
    slug: "msl-league-rules",
    title: "MSL League Rules | Mario Strikers Community",
    description: "Rules of the Mario Strikers League (MSL), currently under review.",
    hiddenHeading: "MSL League Rules",
    robots: "noindex, follow",
  },
  {
    slug: "msl-schedule",
    title: "Mario Strikers League Schedule (MSL)",
    description:
      "Dates and sign-ups of the Mario Strikers League (MSL) 2026: the Spring, Summer and Fall splits and the World Championship, with registration on start.gg.",
    hiddenHeading: "MSL Schedule",
    breadcrumbName: "MSL Schedule",
  },
  {
    slug: "partners",
    title: "Partners of the Mario Strikers Community",
    description:
      "Communities partnered with the Mario Strikers Community: Nintenhub, Mario Strikers Speedrunning, the Wii Sports Server, RAGNAROK and more fan groups.",
    hiddenHeading: "Partners",
  },
  {
    // The compact player popup, screenshotted by the Discord bot for /profile show (?player=<id>).
    slug: "player-card",
    title: "Player Card | Mario Strikers Community",
    description:
      "A compact Mario Strikers player card with name, flag, friend codes and competitive ratings, as the community Discord bot shows it.",
    hiddenHeading: "Player Card",
    robots: "noindex, nofollow",
  },
  {
    slug: "players",
    title: "Players | Mario Strikers Community",
    description: "Browse Mario Strikers player resources, profiles, clubs, and competitive community information.",
    hiddenHeading: "Players",
    robots: "noindex, follow",
  },
  {
    slug: "players-profiles",
    title: "Player Profiles | Mario Strikers Community",
    description: "Browse Mario Strikers player profiles and competitive community records.",
    hiddenHeading: "Player Profiles",
    robots: "noindex, follow",
  },
  {
    slug: "privacy-policy",
    title: "Privacy Policy | Mario Strikers Community",
    description:
      "How the Mario Strikers Community website handles your data: what is shown publicly, what is kept internally, why, for how long, and how to request removal.",
    hiddenHeading: "Privacy Policy",
  },
  {
    slug: "profile",
    title: "My Profile | Mario Strikers Community",
    description: "View your linked Mario Strikers player profile.",
    hiddenHeading: "My Profile",
    robots: "noindex, nofollow",
  },
  {
    slug: "sms",
    title: "SMS | Mario Strikers Community",
    description: "Find Super Mario Strikers resources, rankings, rules, tier lists, and setup guidance.",
    hiddenHeading: "SMS",
    robots: "noindex, follow",
  },
  {
    slug: "sms-competitiverules",
    title: "Super Mario Strikers Competitive Rules (SMS)",
    description:
      "Competitive rules for Super Mario Strikers (SMS): game version, match settings, stadiums, disconnections, stalling, conduct and penalties in community play.",
    hiddenHeading: "Super Mario Strikers Competitive Rules",
  },
  {
    slug: "sms-elo1v1",
    title: "Super Mario Strikers 1v1 ELO Rankings (SMS)",
    description:
      "Live 1v1 ELO leaderboard for Super Mario Strikers (SMS): ranks, ratings, wins and losses of the community's ranked players in the current season.",
    hiddenHeading: "Super Mario Strikers 1v1 ELO Rankings",
  },
  {
    slug: "sms-setup-guide",
    title: "Super Mario Strikers Online Setup Guide (SMS)",
    description:
      "Video guide by Randomepicdude to setting up Super Mario Strikers (SMS) for playing with the community, from getting the game ready to your first match.",
    hiddenHeading: "SMS Setup Guide",
    breadcrumbName: "SMS Setup Guide",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "TechArticle",
        headline: "Super Mario Strikers Online Setup Guide",
        description:
          "Video guide by Randomepicdude to setting up Super Mario Strikers (SMS) for playing with the community, from getting the game ready to your first match.",
        url: "https://mariostrikers.gg/sms-setup-guide",
        inLanguage: "en-US",
        about: {
          "@type": "VideoGame",
          name: "Super Mario Strikers",
          gamePlatform: "GameCube",
        },
        author: {
          "@type": "Person",
          name: "Randomepicdude",
        },
        publisher: {
          "@type": "Organization",
          name: "Mario Strikers Community",
          url: "https://mariostrikers.gg/",
        },
      },
    ],
  },
  {
    slug: "sms-tierlist",
    title: "Super Mario Strikers Tier List (SMS)",
    description:
      "The current competitive tier list for Super Mario Strikers (SMS), ranking the captains and sidekicks by their strength in the community's competitive play.",
    hiddenHeading: "Super Mario Strikers Tier List",
  },
  {
    slug: "sms-whr",
    title: "Super Mario Strikers WHR Rankings (SMS)",
    description:
      "All-time Whole History Rating (WHR) leaderboard for Super Mario Strikers (SMS), recalculated from every reported 1v1 result in the community.",
    hiddenHeading: "Super Mario Strikers WHR Rankings",
    breadcrumbName: "SMS WHR",
  },
  {
    slug: "tab-placeholder",
    title: "Placeholder | Mario Strikers Community",
    description: "Placeholder route for Mario Strikers Community tab navigation.",
    hiddenHeading: "Placeholder",
    robots: "noindex, follow",
  },
];

/** The page nginx answers every unknown URL with (status 404). It is not routable and not indexed. */
export const NOT_FOUND_PAGE: PageDefinition = {
  slug: "404",
  title: "Page Not Found | Mario Strikers Community",
  description:
    "This page does not exist. Find rankings, tournaments, guides and tools on the Mario Strikers Community.",
  hiddenHeading: "Page Not Found",
  robots: "noindex, follow",
};

const PAGES_BY_SLUG = new Map(PAGES.map((page) => [page.slug, page]));

export function findPage(slug: string): PageDefinition | undefined {
  return PAGES_BY_SLUG.get(slug);
}

export function isIndexable(page: PageDefinition): boolean {
  return page.robots === undefined;
}

/** Public URL path of a page: "/" for the home page, "/<slug>" otherwise. */
export function pagePath(slug: string): string {
  return slug === "index" ? "/" : `/${slug}`;
}

export function canonicalUrl(slug: string): string {
  return SITE_ORIGIN + pagePath(slug);
}
