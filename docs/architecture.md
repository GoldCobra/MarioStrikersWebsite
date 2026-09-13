# Architecture and API

## Pages and browser code

The site uses static HTML, shared CSS and browser JavaScript. Page shells live
in `index.html` and `pages/`; fetched fragments live in `pages/templates/`.
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

Public pages use `/slug`, with `/` for home. Express and Nginx both implement
clean routes and permanent redirects from old `.html`, trailing-slash and
legacy alias URLs. Maintain both configurations when changing route behavior.
Canonical metadata, navigation and sitemap entries must agree with public URLs.
The private `/profile` page is excluded from indexing.

Browser-loaded script and style URLs use `?v=...` cache tags. Update every
applicable reference when changing an asset, including scripts loaded by JS.
PNG/WebP pairs in the Gear Builder include intentional fallback behavior.

## Backend and data

Express provides the API. In live mode, MSSQL supplies rankings, players, clubs
and competitive-season data. Discord supplies authentication, member names and
community events. Wiimmfi availability is retrieved through FlareSolverr.

Public leaderboard, player-list, club-list and season responses use a refresh
cache that persists snapshots under `backend/.cache/`. Club logos are cached
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
`elo2v2` and `whr`. The frontend offers all three for MSBL and
`elo1v1`/`whr` for MSC and SMS.
`backend/src/server.js`, service implementations and their tests define
response fields and validation.
