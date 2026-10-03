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
| `src/lib/` | Shared browser helpers: API fetch, countries, the template popup, the dropdown, image fallbacks, sitemap dates |
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

**Popups.** The player and club popups are built on `src/lib/popup.ts`; their
markup (`player-profile-popup.html`, `club-profile-popup.html`) sits next to
their code and is bundled with it. The profile page (`/profile`) shows the
player popup's card as a section of the page (`#player-profile-page`): the same
template, renderer (`features/players/player-profile-view.ts`) and styles, but
no overlay, close button or dialog role; there all text is in MLSBY (the
"Reporter" face) except the name (ITC Grizzly), and the
background starts at the card's top at the card's width, so it never moves when
the card grows. Instead of the rating cards it shows the member's statistics per
game (`features/profile/profile-stats.ts`, `GET /api/profile/me/stats`): MSBL,
MSC and SMS, each with the same ten read-only fields (season rank, ELO and W-L of
the active season, highest season rank, current and highest WHR, total W-L,
matches and win rate, highest legacy rank), the game's ball before each name and
the value right-aligned in a field box; "-" where a value is missing, a real 0 or
0-0 as such - a game or season not played yet has a W-L of 0-0 and 0 matches,
alike in every game. The mouse wheel over the card scrolls the page (the popup
keeps it inside its own boxes, the page does not). The API reads them in one batch for the session's player only
(`modules/profile/stats-repository.ts`; `stats.ts` names each value's source and
rule). The popup, the players page and the Discord card keep their rating cards. Shared popup classes in `src/styles/popups.css` are
`popup-overlay`, `popup-card`, `popup-header`, `popup-title` and `popup-close`.
The hidden page `/player-card?player=<id>` shows the player popup as a compact
card (`showPlayerCard`, class `is-card`) that the Discord bot screenshots for
`/profile show`; `<html data-player-card>` turns `ready` once it has loaded. The
card is 550 px wide and as tall as its content, at most 350 px: Discord's largest
message preview (`player-card.ts` rounds the height to a whole pixel and scales a
taller card down). The bot takes it at its own size, so Discord shows it 1:1. It
looks the same in any window the bot opens (550 px wide or more): it declares the
Reporter type tokens on itself next to `:root`, the popup's phone rules in
`mobile.css` exclude it, and its name has a fixed size
([ADR 0010](adr/0010-shared-fields-dropdown-and-title-type.md)).

**Fields and dropdowns.** A field is a heading over grey one-line boxes (friend
codes, country, title) in the popup, on the card and on the profile page. Its
type, box height (26 px; pencils and editing fields 24 px), padding and heading
gap are the `--field-*` tokens in `styles/base.css`; the profile's open line is
the same box as a closed one. A value is trimmed to its capitals (`text-box`), so
it sits in the middle of its box whatever the face's metrics, ends in an ellipsis
when too long and is never cut at its top or bottom. A choice whose options need
images or a look uses the site's dropdown (`src/lib/dropdown.ts`,
`styles/dropdown.css`): the open list lies in the top layer, so no container cuts
it off and nothing covers it, opens above its field when there is more room
there, is at most 280 px or the room it has tall and scrolls; field and options
take the line's type, options the `--dropdown-*` spacing (also the account menu
and the MSC profile menu). Plain text choices stay native `<select>`s.

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
`src/features/gear-builder/gear-builder-host.ts`, a navigation button's in
`NAV_ICON_VERSIONS` of `src/layouts/site-shell.ts`), and
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
in the configured guild, and sets a signed HTTP-only session cookie (with the
member's server nickname at login). The access token is used only during the
callback and never stored. The main navigation's last button, LOGIN (after
PARTNERS, `rel="nofollow"`, active on `/profile`), is static and starts the
login; without a configured login it leads to the profile page's explanation.
Signed in (`/api/auth/me`), `features/nav/nav.ts` turns it into the account
button: the member's Discord avatar covers its login figure, and a click opens
MY PROFILE and LOGOUT. All six buttons stand 1px apart and shrink only where the
row would otherwise reach the logo.
`/api/profile/me` maps the Discord user to `Player.DiscordID` (unique). A member
without a player profile gets one at login (`modules/profile/`): one batch locks
the Discord id's key range, inserts `dbo.Player` named after the member's server
display name (nickname, else global name, else username, without a leading
`[TAG]` of the bot's nickname sync) and logs it in `dbo.CommandLog`, so parallel
logins and the bots' own inserts never create a second row. When that fails, the
login still succeeds and the profile page asks again (`POST /api/profile/me`).
On the profile page (`/profile`, `features/profile/`) the member changes the
title, the country and the friend codes in place: a pencil opens one field (the
title, the country, the Switch code, an MSC code) without saving it, "+" adds an MSC code and "−"
removes an open one; a click outside an open field closes it again, keeping what was entered (an empty
code line added with "+" goes). Changes collect in a draft (`profile-edit-state.ts`), are
marked unsaved, and SAVE sends the whole profile in one request, DISCARD (after a
confirmation) drops them; leaving with unsaved changes warns. The country is the
site's dropdown with the local flags (`country-select.ts`, `dbo.Enumeration`'s list);
messages are toasts at the bottom right (`profile-toasts.ts`, `aria-live`). The
page also shows the member's Discord username, right of the club line. A save
goes to the tables robotic_nightmare's `/profile` commands use, in their exact
form ([ADR 0007](adr/0007-profile-writes-in-shared-database.md)): one
transaction, refused with `409 PROFILE_CHANGED` when the profile changed since
the page loaded it (a version hash; the page then lays the draft on top of what
is saved now and marks what was changed on both sides), and with
`409 FRIEND_CODE_TAKEN` for a code another profile has. The rules live once in `packages/shared/src/friend-codes.ts`; an older MSC
code saved without a platform may stay so, a new or changed one needs it. Saves
are refused for members who left the server, checked with the bot token
(`integrations/discord/members.ts`).
A bot token enables Discord name lookups and event discovery.

**Player titles** ([ADR 0008](adr/0008-player-titles.md), [ADR 0009](adr/0009-per-game-titles-and-test-unlocks.md),
`modules/titles/`).
A member picks one of their titles on the profile page; the player popup and the
Discord card show it as the content's first line, before the friend codes (without
a title the line takes no room), the profile page in its "Player Title" field. Each
title is shown in FULL CAPS and in its group's look, colour and glow, in the popup,
on the card, in the profile's field and in its dropdown alike: `titleLook`
(`availability.ts`) assigns it, `.player-title` in `styles/player-popup.css` holds
its face, size, spacing (`--player-title-letter-spacing`), colours and glows once,
and `playerTitleHtml()`/`showPlayerTitle()` (`player-profile-view.ts`) build every
title with its ball. A title of one game
(`dbo.PlayerTitle.GameCode`: MSL, tournament and season titles; `games.ts`) shows
that game's ball before it everywhere (`titleBallHtml` in
`features/players/player-profile-view.ts`, the accolades' 16px ball). Five
`dbo` tables hold them: categories, titles (with the rule that awards each one and
its game), unlocks (one per player and title, with their source), temporary test
unlocks (apart from the earned ones) and the selected title.
Free Titles are available to everyone; of an exclusive group (legacy ranks,
N-TIME WORLD CHAMPION of a game) only the highest unlocked level is offered, while
the green and the plain TOURNAMENT WINNER can both be selected; an MSL event
template is never offered, a fixed title only to its owners, and test unlocks add
every level on top (`availability.ts`). The same file sets the list's order, which
the profile page shows as it comes, without category names: categories by
`SortOrder`, Free Titles always last (a new category falls in before them); MSL in
groups X-TIME WORLD CHAMPION (5 down to 2), WORLD, FALL, SUMMER, SPRING CHAMPION,
each by year (newest first); season titles by year and season, the green
TOURNAMENT WINNER first, legacy ranks from the highest, Free Titles A–Z; the same
title in several games MSBL, MSC, SMS; equal ranks by code. `rules.ts` awards from
existing data, each title in its game: a season's Strikers Titans (reward level
5/5, once the season is completed; the season's title of that game is created
then), MSL event winners (the template creates the game variant), counts of MSL
World Championships and of clear non-MSL wins in one game, the fixed WFC titles to
their owners (player and Discord id), and the highest legacy rank held when the
competitive ranks began (no game). Unclear data awards nothing and is reported. The
API runs the rules once a day (`TITLE_SYNC_INTERVAL_MS`; the last run is logged in
`dbo.CommandLog`); `npm run ops:player-titles` creates the tables and adds missing
titles of `catalog.ts`, `npm run ops:title-sync` awards on demand (a dry run
without `-- --apply`); `npm run ops:title-order` and `npm run ops:title-games`
brought the changes of 2026-10-02 into existing rows (backups
`dbo.*_Backup_20261002` and `_20261002b`); `npm run ops:title-test-unlocks` grants
or revokes a player's test unlocks. A new title of a known kind is one row in
`dbo.PlayerTitle` (or a line in `catalog.ts` plus `ops:player-titles`).

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
short-lived `msc_oauth_state` cookie, logout and profile changes refuse
cross-site requests, and club logos are only downloaded from public HTTPS
addresses.

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
| GET | `/api/auth/me` | Current login state and whether login is available |
| POST | `/api/auth/logout` | Clear session |
| GET | `/api/profile/me` | Authenticated user's linked profile |
| POST | `/api/profile/me` | Create the authenticated user's profile when the login could not |
| GET | `/api/profile/me/editable` | The editor's profile: Discord names, title, country, friend codes, the member's titles, countries |
| GET | `/api/profile/me/stats` | MY PROFILE's statistics per game (MSBL, MSC, SMS) of the signed-in player; `null` for a value not available |
| PUT | `/api/profile/me/editable` | Save the editor's title, country and friend codes (JSON, with `version`) |
| GET | `/api/health` | Service health |

Leaderboard games are `msbl`, `msc` and `sms`; modes are `elo1v1`,
`elo2v2` and `whr`. The tab strip offers `elo1v1` and `whr` for all three
games; the `msbl-elo2v2` page and route still exist but have no tab.
WHR is the all-time 1v1 rating that futbot recalculates from every reported
result; the backend only reads it.
The route modules in `apps/api/src/modules/` and their tests define response
fields and validation.
