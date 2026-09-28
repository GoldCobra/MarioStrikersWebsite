# 0003: One page registry for routes, navigation and metadata

Status: accepted (2026-09-27)

## Context

The list of pages existed in at least eight places: the navigation script,
the data preload, the leaderboard configuration, nginx, the API server, the
sitemap, the robots tags of each page and CI. They had already drifted apart
(case handling, trailing slashes, old `/slug.html` links).

## Decision

`packages/shared/src/site/` is the single source. `pages.ts` lists every page
with its title, description, hidden heading, robots and sitemap settings;
`navigation.ts` holds the menu model, `legacy-routes.ts` the old URLs, and
`routes.ts` resolves any request path exactly as production nginx does.
The legacy-route part of the nginx configuration is generated from it
(`npm run generate:nginx`; `npm run check` fails when it is stale), the
sitemap is rendered from it, and the local servers route with the same
function.

## Consequences

- Adding or renaming a page touches the registry and one page file; a unit
  test fails when the two disagree.
- A recorded list of 367 production URL shapes (`tests/e2e/golden/routes.json`)
  is replayed against both `resolveRoute()` and nginx.
