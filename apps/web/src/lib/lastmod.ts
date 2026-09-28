// Build-time only: the date a page's content last changed, for the sitemap. deploy.py writes the date of
// the last commit of every web source file to .release/lastmod.json before the image build (the build
// works from an archive without history). A page's date is the newest of its page file and the content
// its page family renders; changes to the shared layout or navigation do not count. Local builds have no
// file, and the sitemap then has no dates, because a wrong date is worse than none.

import fs from "node:fs";
import path from "node:path";

export type LastmodDates = Readonly<Record<string, string>>;

/** Content files a page family renders, by the component a page file uses. */
const FAMILY_CONTENT: Readonly<Record<string, readonly string[]>> = {
  RulesPage: ["apps/web/src/content/competitive-rules/rules.ts", "apps/web/src/content/competitive-rules/render.ts"],
  TierListPage: ["apps/web/src/content/tier-lists.ts"],
};

export function loadLastmod(file = path.join(process.cwd(), ".release/lastmod.json")): LastmodDates | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as LastmodDates;
  } catch {
    return null;
  }
}

export function pageFile(slug: string): string {
  return slug === "index" ? "apps/web/src/pages/index.astro" : `apps/web/src/pages/pages/${slug}.astro`;
}

/** The newest commit date of the page's own sources, or undefined when none is recorded. */
export function pageLastmod(slug: string, dates: LastmodDates, pageSource: string): string | undefined {
  const files = [pageFile(slug)];
  for (const [component, content] of Object.entries(FAMILY_CONTENT)) {
    if (pageSource.includes(component)) files.push(...content);
  }
  return files
    .map((file) => dates[file])
    .filter((date): date is string => typeof date === "string")
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}
