// The sitemap: every indexable page of the registry. It has no lastmod, because a wrong date is worse
// than none for search engines, and the build has no history to take real dates from.

import type { APIRoute } from "astro";
import { PAGES, canonicalUrl, isIndexable } from "@ms/shared/site/pages";

export const GET: APIRoute = () => {
  const urls = PAGES.filter(isIndexable).map((page) => `  <url>\n    <loc>${canonicalUrl(page.slug)}</loc>\n  </url>`);
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
