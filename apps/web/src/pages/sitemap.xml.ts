// The sitemap: every indexable page of the registry, with the date its content last changed when the
// release recorded one (see src/lib/lastmod.ts).

import fs from "node:fs";
import path from "node:path";
import type { APIRoute } from "astro";
import { PAGES, canonicalUrl, isIndexable } from "@ms/shared/site/pages";
import { loadLastmod, pageFile, pageLastmod } from "../lib/lastmod.ts";

export const GET: APIRoute = () => {
  const dates = loadLastmod();
  const repoRoot = path.resolve(process.cwd(), "../..");
  const urls = PAGES.filter(isIndexable).map((page) => {
    const source = dates ? fs.readFileSync(path.join(repoRoot, pageFile(page.slug)), "utf8") : "";
    const lastmod = dates ? pageLastmod(page.slug, dates, source) : undefined;
    return [
      "  <url>",
      `    <loc>${canonicalUrl(page.slug)}</loc>`,
      ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
      "  </url>",
    ].join("\n");
  });
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
