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
  /** Omitted for indexable pages. */
  readonly robots?: Robots;
  /** Static data-subnav attribute that reserves the sub-navigation height before scripts run. */
  readonly subnav?: "on" | "off";
  readonly jsonLd?: readonly JsonLd[];
}

export const PAGES: readonly PageDefinition[] = [
  {
    slug: "index",
    title: "Mario Strikers Community",
    description:
      "Join the Mario Strikers Community for matches, tournaments, rankings, tools, and resources across Mario Strikers Battle League, Charged, and Super Mario Strikers.",
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
              "Join the Mario Strikers Community for matches, tournaments, rankings, tools, and resources across Mario Strikers Battle League, Charged, and Super Mario Strikers.",
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
    title: "About Us | Mario Strikers Community",
    description:
      "Learn about the fan-run Mario Strikers Community, regular matches, events, tournaments, and the Mario Strikers League.",
    subnav: "off",
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
    subnav: "on",
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
    title: "MSBL Competitive Rules | Mario Strikers Community",
    description: "Read competitive rules for Mario Strikers Battle League events and ranked community play.",
    hiddenHeading: "MSBL Competitive Rules",
  },
  {
    slug: "msbl-elo1v1",
    title: "MSBL ELO 1v1 | Mario Strikers Community",
    description: "View MSBL 1v1 ELO rankings for Mario Strikers Battle League community competition.",
    hiddenHeading: "MSBL ELO 1v1",
  },
  {
    slug: "msbl-elo2v2",
    title: "MSBL ELO 2v2 | Mario Strikers Community",
    description: "View MSBL 2v2 ELO rankings for Mario Strikers Battle League community competition.",
    hiddenHeading: "MSBL ELO 2v2",
  },
  {
    slug: "msbl-gear-builder",
    title: "MSBL Gear Builder | Mario Strikers Community",
    description: "Build and compare Mario Strikers Battle League gear setups with the MSBL Gear Builder.",
    hiddenHeading: "MSBL Gear Builder",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "MSBL Gear Builder",
        url: "https://mariostrikers.gg/msbl-gear-builder",
        description: "Build and compare Mario Strikers Battle League gear setups with the MSBL Gear Builder.",
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
    title: "MSBL Save Editor | Mario Strikers Community",
    description: "Use the MSBL Save Editor resource for Mario Strikers Battle League save editing workflows.",
    hiddenHeading: "MSBL Save Editor",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "MSBL Save Editor",
        url: "https://mariostrikers.gg/msbl-save-editor",
        description: "Use the MSBL Save Editor resource for Mario Strikers Battle League save editing workflows.",
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
    title: "MSBL Clubs | Mario Strikers Community",
    description: "Explore MSBL clubs and player groups in the Mario Strikers Battle League community.",
    hiddenHeading: "MSBL Clubs",
  },
  {
    slug: "msbl-tierlist",
    title: "MSBL Tier Lists | Mario Strikers Community",
    description: "Browse MSBL tier lists for Mario Strikers Battle League competitive play.",
    hiddenHeading: "MSBL Tier Lists",
  },
  {
    slug: "msbl-whr",
    title: "MSBL WHR | Mario Strikers Community",
    description: "View MSBL WHR rankings for Mario Strikers Battle League community competition.",
    hiddenHeading: "MSBL WHR",
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
    title: "MSC Competitive Rules | Mario Strikers Community",
    description: "Read competitive rules for Mario Strikers Charged events and ranked community play.",
    hiddenHeading: "MSC Competitive Rules",
  },
  {
    slug: "msc-elo1v1",
    title: "MSC ELO 1v1 | Mario Strikers Community",
    description: "View MSC 1v1 ELO rankings for Mario Strikers Charged community competition.",
    hiddenHeading: "MSC ELO 1v1",
  },
  {
    slug: "msc-save-editor",
    title: "MSC Save Editor | Mario Strikers Community",
    description: "Use the MSC Save Editor resource for Mario Strikers Charged save editing workflows.",
    hiddenHeading: "MSC Save Editor",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "MSC Save Editor",
        url: "https://mariostrikers.gg/msc-save-editor",
        description: "Use the MSC Save Editor resource for Mario Strikers Charged save editing workflows.",
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
    title: "MSC Setup Guide | Mario Strikers Community",
    description:
      "Follow the Mario Strikers Charged online setup guide for Wii, Wii U, Dolphin, Wiimmfi, and stable competitive play.",
  },
  {
    slug: "msc-tierlist",
    title: "MSC Tier Lists | Mario Strikers Community",
    description: "Browse MSC tier lists for Mario Strikers Charged competitive play.",
    hiddenHeading: "MSC Tier Lists",
  },
  {
    slug: "msc-whr",
    title: "MSC WHR | Mario Strikers Community",
    description: "View MSC WHR rankings for Mario Strikers Charged community competition.",
    hiddenHeading: "MSC WHR",
  },
  {
    slug: "msc-wiimmfi",
    title: "WIIMMFI | Mario Strikers Community",
    description: "Find Mario Strikers Charged Wiimmfi information for online community play.",
    hiddenHeading: "MSC WIIMMFI",
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
    subnav: "on",
  },
  {
    slug: "msl-league-rules",
    title: "MSL League Rules | Mario Strikers Community",
    description: "Read Mario Strikers League rules for structured competitive league play.",
    hiddenHeading: "MSL League Rules",
  },
  {
    slug: "msl-schedule",
    title: "MSL Schedule | Mario Strikers Community",
    description: "Check the Mario Strikers League schedule and league site resources.",
    hiddenHeading: "MSL Schedule",
  },
  {
    slug: "partners",
    title: "Partners | Mario Strikers Community",
    description: "Find community partners and connected Mario Strikers projects, creators, and resources.",
    hiddenHeading: "Partners",
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
      "Read the Mario Strikers Community privacy policy for website data, analytics, and contact information.",
    hiddenHeading: "Privacy Policy",
    subnav: "off",
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
    title: "SMS Competitive Rules | Mario Strikers Community",
    description: "Read competitive rules for Super Mario Strikers events and ranked community play.",
    hiddenHeading: "SMS Competitive Rules",
  },
  {
    slug: "sms-elo1v1",
    title: "SMS ELO 1v1 | Mario Strikers Community",
    description: "View SMS 1v1 ELO rankings for Super Mario Strikers community competition.",
    hiddenHeading: "SMS ELO 1v1",
  },
  {
    slug: "sms-setup-guide",
    title: "SMS Setup Guide | Mario Strikers Community",
    description: "Follow the Super Mario Strikers setup guide for community play and competitive preparation.",
    hiddenHeading: "SMS Setup Guide",
  },
  {
    slug: "sms-tierlist",
    title: "SMS Tier Lists | Mario Strikers Community",
    description: "Browse SMS tier lists for Super Mario Strikers competitive play.",
    hiddenHeading: "SMS Tier Lists",
  },
  {
    slug: "sms-whr",
    title: "SMS WHR | Mario Strikers Community",
    description: "View SMS WHR rankings for Super Mario Strikers community competition.",
    hiddenHeading: "SMS WHR",
  },
  {
    slug: "tab-placeholder",
    title: "Placeholder | Mario Strikers Community",
    description: "Placeholder route for Mario Strikers Community tab navigation.",
    hiddenHeading: "Placeholder",
    robots: "noindex, follow",
  },
];

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
