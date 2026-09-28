# 0001: Static pages with Astro, live data in the browser

Status: accepted (2026-09-27)

## Context

The site was 42 hand-written HTML files with about 24 identical lines each.
Navigation, footer and breadcrumbs were inserted by a script, so the pages
search engines fetched contained no internal links. Titles, descriptions and
structured data were copied by hand between files.

## Decision

Astro renders every page to static HTML at build time from one layout
(`apps/web/src/layouts/SiteLayout.astro`) and the page registry (ADR 0003).
Navigation, tabs, footer, breadcrumbs, head metadata and content such as the
competitive rules and tier lists are part of that HTML. Data that changes
during the day (leaderboards, players, clubs, events, the season clock) is
still loaded by the browser from the API; there is no server-side rendering.
nginx serves the built files.

## Consequences

- Search engines see every internal link and the full text of content pages.
- A page change is one `.astro` file and, if needed, one registry entry.
- The layout keeps the whitespace of the former pages exactly, because text
  between inline elements takes space; DOM goldens check it (ADR 0004).
- Live data stays as fresh as before and needs no rendering servers.
