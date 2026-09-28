# Architecture and API

## Pages and browser code

Astro renders every page at build time into static HTML; live data is still
loaded in the browser. In `apps/web/`:

| Location | Purpose |
| --- | --- |
| `src/layouts/SiteLayout.astro` | The document around every page: head metadata from the page registry, navigation, content tabs, footer, scripts |
| `src/layouts/site-shell.ts` | Markup of the navigation, tabs and footer, rendered from the navigation model |
| `src/entries/`, `src/features/<name>/` | Browser code in TypeScript, bundled by Vite with content-hashed file names: one entry per page type, one folder per feature |
| `src/layouts/assets.ts` | Every legacy browser script and page-specific stylesheet with its cache tag, in one place |
| `src/styles/` | The global stylesheet as partials named after the components they style; `global.ts` fixes their order |
| `src/pages/index.astro`, `src/pages/pages/<slug>.astro` | One file per page; built to `/index.html` and `/pages/<slug>.html`, served at `/` and `/<slug>` |
| `src/components/pages/` | Page families: section overviews, leaderboards, rules and tier lists |
| `public/` | Web root: legacy browser `js/` (moving to `src/features/`), `assets/`, fetched fragments in `pages/templates/` |

Navigation, tabs, breadcrumbs (JSON-LD) and favicons are static markup, so
search engines see every internal link. The layout keeps the whitespace of the
former hand-written pages exactly, because text between inline elements takes
space; the DOM goldens check it. `src/entries/site.ts`, loaded on every page,
adds the behaviour (`src/features/nav/`): the account widget, the tab strip
(`src/features/tabs/`), centring of overflowing navigation, link prefetching and
redirects of old `?tabs=` and `?submenu=` links. Modules run before the legacy
scripts and set no globals. Shared popup classes in `src/styles/popups.css` are
`popup-overlay`, `popup-card`, `popup-header`, `popup-title` and `popup-close`.

**Adding a page:** add it to `packages/shared/src/site/pages.ts` (title,
description, hidden heading, robots; an indexable page needs a title of at most
60 characters and a description of 120–160, a game page the game's full name in
both), place it in the navigation model
(`navigation.ts`) if it needs a menu entry or tab, create
`src/pages/pages/<slug>.astro` with `SiteLayout` (or a family component), and
list its scripts by name from `assets.ts`. A unit test fails when the registry
and the page files disagree. Page modules go into the layout's `scripts` slot
(`<Fragment slot="scripts"><script src="…"></script></Fragment>`).

The players list, the player popup (`src/features/players/`), the profile page
(`src/features/profile/`), the rating cards (`src/features/rating-cards/`), the
clubs list with its club popup (`src/features/clubs/`) and the leaderboards
(`src/features/leaderboards/`: the tab strip is rendered into the page, the rows
load in the browser) are modules. `src/lib/` holds the shared API fetch, the
country helpers and `popup.ts`, the template popup both profile popups are built
on. The
competitive rules are rendered at build time from `src/content/competitive-rules/`
(edit the typed text in `rules.ts`), so their pages need no script and search
engines read the full text. The popups are loaded from
`/pages/templates/player-profile-popup.html` and `club-profile-popup.html`.
The Gear Builder loads `/pages/templates/msbl-gear-builder.html` and its assets
under `assets/gear-builder/`.

Browser code calls the API on the same origin (`/api/...`).

## Routing and caching

Public pages use `/slug`, with `/` for home. `packages/shared/src/site/` is the
single source: `pages.ts` lists every page with its head metadata,
`navigation.ts` the menu model, `legacy-routes.ts` old URLs, and `routes.ts`
resolves any request path exactly as production nginx does. The local servers
use `resolveRoute()`; `npm run generate:nginx` writes the legacy-route part of
the nginx configuration, and `npm run check` fails when it is stale. A unit
test replays every URL shape recorded against production through
`resolveRoute()`. Canonical metadata, navigation and sitemap entries must agree
with public URLs.
The private `/profile` page is excluded from indexing. `/sitemap.xml` is
generated from the indexable pages of the registry. Unknown URLs get the site's
own not-found page (`src/pages/404.astro`) with status 404, and API responses
carry `X-Robots-Tag: noindex`.

The global stylesheet is delivered as one file named by its content hash
(`/css/global.<hash>.css`), so browsers cache it for a year and a change
always reaches them. Its partials are concatenated in the order listed in
`src/styles/global.ts`; that order is the cascade, and the media blocks in
`tablet.css` and `mobile.css` come last on purpose. Other browser-loaded
script and style URLs use `?v=...` cache tags: pages take them from
`apps/web/src/layouts/assets.ts`; scripts that load other files by URL keep
their own tags until they move to bundled modules.
PNG/WebP pairs in the Gear Builder include intentional fallback behavior.

## Backend and data

The API is a Fastify application written in TypeScript; Node runs the sources
directly, without a build step. In live mode, MSSQL supplies rankings, players, clubs
and competitive-season data. Discord supplies authentication, member names and
community events. Wiimmfi availability is retrieved through FlareSolverr.

Public leaderboard, player-list, club-list and season responses use a refresh
cache that persists snapshots under `.cache/` in the API's working directory
(`apps/api/.cache/` locally, `/app/.cache` in the container). Club logos are cached
there too. These are runtime caches, not source data; production stores them
on a named Docker volume. Account/profile responses use `no-store`. Season
responses also use `no-store`: season data remains cached internally, but
`serverNowUtc` is generated at response time for countdown synchronization.

Discord OAuth requests `identify` and `guilds.members.read`, checks membership
in the configured guild, and sets a signed HTTP-only session cookie.
`/api/profile/me` maps the Discord user to `Player.DiscordID`. A bot token
enables Discord name lookups and event discovery.

Local development uses synthetic fixtures through the same public route
shapes; see [development](development.md) for simulated versus live behavior.

### API code layout

Everything lives under `apps/api/src/`:

| Location | Purpose |
| --- | --- |
| `main.ts`, `dev.ts`, `dev-live.ts` | Entry points: production, fixtures, local live services |
| `app.ts` | Builds the Fastify app: plugins, error handling and every route module |
| `config.ts` | Typed configuration; `.env.example` lists every variable |
| `data-source.ts` | The `DataSource` interface the routes read from, and its live implementation |
| `fixtures/` | The invented `DataSource` of local development and tests |
| `modules/<domain>/` | `routes.ts`, `service.ts`, `repository.ts` (SQL), `mappers.ts` and their tests |
| `cache/`, `db/`, `http/`, `integrations/`, `lib/` | Public data cache, MSSQL pool, reply helpers and errors, Discord REST, small utilities |
| `ops/` | One-off maintenance commands (`npm run ops:*` in `apps/api`) |

A new endpoint goes into the module of its domain: SQL in `repository.ts`,
shaping in `service.ts`/`mappers.ts`, the HTTP contract in `routes.ts`, which
`app.ts` registers. Data the routes need is added to `DataSource` and to both
implementations, so fixtures keep covering it.

### Errors and security

Every error answers `{ "error": "...", "code": "..." }` with `Cache-Control:
no-store`, sometimes with extra fields (the profile routes add `account`).
Unexpected errors are logged with the request id and answered as a generic
`500 INTERNAL`; database and configuration details never reach clients.
Uncached routes (profiles, login) are rate-limited per client address in
production. The Discord login binds its OAuth state to the browser with a
short-lived `msc_oauth_state` cookie, logout refuses cross-site requests, and
club logos are only downloaded from public HTTPS addresses.

## API reference

All endpoints below use the same origin as the website.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/leaderboards/:game/:mode?limit=100&offset=0` | Ranked rows |
| GET | `/api/leaderboards/:game/:mode/top?limit=25` | Top ranked rows |
| GET | `/api/clubs/msbl` (alias `/api/clubs`) | Club list |
| GET | `/api/clubs/msbl/:clubId/profile` | Club details and roster |
| GET | `/api/clubs/msbl/:clubId/logo` | Cached club image |
| GET | `/api/players` | Player list |
| GET | `/api/players/:playerId/profile` | Player profile |
| GET | `/api/competitive-season/current` | Current competitive season |
| GET | `/api/events/community` | Community events |
| GET | `/api/wiimmfi/msc-charged` | Online MSC players |
| GET | `/api/auth/discord/start?returnTo=/profile` | Begin login |
| GET | `/api/auth/discord/callback` | Complete login |
| GET | `/api/auth/me` | Current login state |
| POST | `/api/auth/logout` | Clear session |
| GET | `/api/profile/me` | Authenticated user's linked profile |
| GET | `/api/health` | Service health |

Leaderboard games are `msbl`, `msc` and `sms`; modes are `elo1v1`,
`elo2v2` and `whr`. The tab strip offers `elo1v1` and `whr` for all three
games; the `msbl-elo2v2` page and route still exist but have no tab.
WHR is the all-time 1v1 rating that futbot recalculates from every reported
result; the backend only reads it.
The route modules in `apps/api/src/modules/` and their tests define response
fields and validation.
