# Architecture and API

## Pages and browser code

Astro renders every page at build time into static HTML; live data is loaded
in the browser. In `apps/web/`:

| Location | Purpose |
| --- | --- |
| `src/pages/index.astro`, `src/pages/pages/<slug>.astro` | One file per page; built to `/index.html` and `/pages/<slug>.html`, served at `/` and `/<slug>` |
| `src/components/pages/` | Page families: section overviews, leaderboards, rules and tier lists |
| `src/layouts/SiteLayout.astro` | The document around every page: head metadata from the page registry, navigation, content tabs, footer, the page's module |
| `src/layouts/site-shell.ts` | Markup of the navigation, tabs and footer, rendered from the navigation model |
| `src/content/` | Page content as typed data, rendered at build time: competitive rules, tier lists, Gear Builder characters |
| `src/entries/` | One module per page type, loaded through the layout's `scripts` slot; it starts that page's features |
| `src/features/<name>/` | Browser code in TypeScript, one folder per feature, bundled by Vite with content-hashed file names |
| `src/lib/` | Shared browser helpers: API fetch, countries, the template popup, image fallbacks, sitemap dates |
| `src/styles/` | The global stylesheet as partials named after the components they style; `global.ts` fixes their order |
| `src/layouts/assets.ts` | The Gear Builder's stylesheets with their cache tags |
| `public/` | Served as it is: `assets/` (including the Gear Builder snapshot) and the Gear Builder template in `pages/templates/` |

**Static markup.** Navigation, tabs, breadcrumbs (JSON-LD), favicons and the
competitive rules are rendered into the page, so search engines see every
internal link and the full text. Link previews (Open Graph, Twitter) use
`public/assets/og/mariostrikers-og.jpg`, rendered from the site's artwork by
`node tools/src/render-og-image.ts`. The layout keeps the whitespace of the
former hand-written pages exactly, because text between inline elements takes
space; the DOM goldens check it.

**Behaviour.** `src/entries/site.ts`, loaded on every page, runs the navigation
(`src/features/nav/`): the account widget, the tab strip (`src/features/tabs/`),
centring of overflowing navigation, link prefetching and redirects of old
`?tabs=` and `?submenu=` links. The page entries add the features: players and
the player popup (`players/`), the profile page (`profile/`), rating cards
(`rating-cards/`), clubs and the club popup (`clubs/`), leaderboard rows
(`leaderboards/`), the home page countdowns (`landing-countdown/`), community
events (`events/`), the MSC Wiimmfi list (`wiimmfi/`), the placeholder page
(`placeholder/`), the save editors (`save-editors/`, pure byte-level cores plus
page code; see [save formats](save-tools.md)) and the host of the third-party
Gear Builder (`gear-builder/`). Logic without DOM access (the season clock, the
save cores, the rating cards) is unit-tested in Node. Browser code calls the
API on the same origin (`/api/...`) and sets no globals.

**Popups.** Both profile popups are built on `src/lib/popup.ts`; their markup
(`player-profile-popup.html`, `club-profile-popup.html`) sits next to their code
and is bundled with it. Shared popup classes in `src/styles/popups.css` are
`popup-overlay`, `popup-card`, `popup-header`, `popup-title` and `popup-close`.
The hidden page `/player-card?player=<id>` shows the player popup as a compact
card (`showPlayerCard`, class `is-card`) that the Discord bot screenshots for
`/profile show`; `<html data-player-card>` turns `ready` once it has loaded. The
card is always 550 × 350 px, Discord's largest message preview, and the bot
takes it at that size, so Discord shows it 1:1.

**No inline code.** Markup carries no inline scripts or event handlers, so the
Content Security Policy can forbid them: an image states its fallback as
`data-fallback-src` or `data-on-error="remove|hide"`, handled by
`src/lib/image-fallbacks.ts`. `npm run check:frontend` rejects inline handlers.

**Gear Builder.** It loads `/pages/templates/msbl-gear-builder.html` and its
assets under `assets/gear-builder/`; its 16 character panes are rendered at
build time from `src/content/gear-builder/` (see
[Gear Builder maintenance](msbl-gear-builder-snapshot.md)).

**A new page** follows the steps in [contributing](../CONTRIBUTING.md#common-changes);
a unit test fails when the registry and the page files disagree.

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
generated from the indexable pages of the registry; its `lastmod` is the date the page's
content last changed, which `scripts/deploy.py` records from the git history
before the image build (`src/lib/lastmod.ts`). Unknown URLs get the site's
own not-found page (`src/pages/404.astro`) with status 404, and API responses
carry `X-Robots-Tag: noindex`.

The global stylesheet is delivered as one minified file named by its content
hash (`/css/global.<hash>.css`), so browsers cache it for a year and a change
always reaches them. Minifying (lightningcss) removes comments, whitespace and
declarations a later one in the same rule overrides; a test checks that every
at-rule, prefixed declaration, `!important` and referenced file survives, and
invalid CSS fails the build. `npm run lint:css` (stylelint, part of
`npm run check`) catches invalid values, unknown properties and duplicates. The
brand colours are custom properties in `base.css` (`--color-gold`,
`--color-amber`, `--color-orange`, `--color-maroon`, `--color-text-light`,
plus one `--game-color-*` per game). Its partials are concatenated in the order listed in
`src/styles/global.ts`; that order is the cascade, and the media blocks in
`tablet.css` and `mobile.css` come last on purpose. Modules are bundled with
content-hashed names. Files under `public/` (images, fonts, the Gear Builder
snapshot) keep their URL: a changed one needs its `?v=` tag bumped where it is
referenced (the Gear Builder's in `src/layouts/assets.ts` and
`src/features/gear-builder/gear-builder-host.ts`), and
`apps/web/assets.lock.json` makes `npm run check` fail until that is done.
PNG/WebP pairs in the Gear Builder include intentional fallback behavior.

Security headers: Caddy sends HSTS, `nosniff`, `Referrer-Policy` and
`X-Frame-Options`; nginx adds a Content Security Policy, `Permissions-Policy`
and `Cross-Origin-Opener-Policy` to every document
(`infra/nginx/snippets/document-headers.conf`). The policy is enforced; a
change to it should first be checked with `npm run test:dom` (the CSP check)
and, when it affects third-party content, on the live site in report-only mode.

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
`server_now_utc` is generated at response time for countdown synchronization.

Discord OAuth requests `identify` and `guilds.members.read`, checks membership
in the configured guild, and sets a signed HTTP-only session cookie.
`/api/profile/me` maps the Discord user to `Player.DiscordID`. A bot token
enables Discord name lookups and event discovery.

Responses use snake_case keys throughout; code inside the API uses camelCase
and converts at the route (the season route shows how, since its cached
snapshot keeps the service's shape).

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
