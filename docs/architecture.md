# Architecture and API

## Pages and browser code

The site uses static HTML, shared CSS and browser JavaScript in
`apps/web/public/`, the web root; paths in this section are relative to it. Page
shells live in `index.html` and `pages/`; fetched fragments live in `pages/templates/`.
Use a configured local server because templates and API calls use `fetch()`.

Each page sets `body data-page="..."`. `js/global-nav.js` uses it to build
navigation and the footer; `js/global-tabs-engine.js` manages page tabs.
Shared popup classes in `css/global.css` are `popup-overlay`, `popup-card`,
`popup-header`, `popup-title` and `popup-close`.

Leaderboard and competitive-rules modules pair a `*-config.js` with a shared
`*-engine.js`. Players, clubs and account profiles have their own engines.
The player popup is loaded from `/pages/templates/player-profile-popup.html`.
The Gear Builder loads `/pages/templates/msbl-gear-builder.html` and its assets
under `assets/gear-builder/`.

`js/runtime-config.js` sets `window.APP_RUNTIME_CONFIG.leaderboardsApiBase`.
Its empty default means same-origin `/api/...` requests. A separate API host
requires an explicit base URL and matching server configuration.

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
The private `/profile` page is excluded from indexing.

Browser-loaded script and style URLs use `?v=...` cache tags. Update every
applicable reference when changing an asset, including scripts loaded by JS.
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
