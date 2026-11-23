# Architecture and API

## Pages and browser code

Astro renders every page at build time into static HTML; live data is loaded
in the browser. In `apps/web/`:

| Location | Purpose |
| --- | --- |
| `src/pages/index.astro`, `src/pages/pages/<slug>.astro` | One file per page; built to `/index.html` and `/pages/<slug>.html`, served at `/` and `/<slug>` |
| `src/components/pages/` | Page families: section overviews, text pages (one box in the setup guide layout), leaderboards, rules and tier lists |
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
matches and win rate (one decimal), highest legacy rank), the game's ball before each name and
the value right-aligned in a field box; "-" where a value is missing, a real 0 or
0-0 as such, but only for a player already rated in that game - a game never
rated shows "-" throughout. The mouse wheel over the card scrolls the page (the popup
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
The account's private pages (`/profile`, `/my-club`) are excluded from indexing. `/sitemap.xml` is
generated from the indexable pages of the registry; its `lastmod` is the date the page's
content last changed, which `scripts/deploy.py` records from the git history
before the image build (`src/lib/lastmod.ts`). Unknown URLs get the site's
own not-found page (`src/pages/404.astro`) with status 404 (never stored), and
API responses carry `X-Robots-Tag: noindex`.

**Admin page** ([ADR 0011](adr/0011-hidden-admin-page.md)). `src/pages/admin.astro`
is no registered page (`ADMIN_PAGE` in `pages.ts`, like the not-found page):
after the build `integrations/private-pages.ts` moves it and the modules only it
uses (`entries/admin-page.ts`, `features/admin/`) to `apps/web/dist-private/admin/`,
and `npm run check:frontend` fails when anything of it stays in `dist/`. nginx
keeps it outside the web root and serves `/_/<token>/` only when the API's
internal gate says yes (`auth_request`); `tools/src/site-server.ts` does the same
locally. The fixtures switch it on with an invented path
(`/_/fixture-admin-page-0000000/`) and the `sample-admin` login.

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

All SQL goes through one core ([ADR 0014](adr/0014-data-access-on-the-local-database.md)):
statements are tagged templates whose values are parameters (`db/sql.ts`), run by
one pool to the SQL Server container next to the API (`db/database.ts`: rows, a
batch's result sets, transactions with an optional retry after a deadlock, every
statement slower than 500 ms logged). Each module keeps its SQL in `repository.ts`.

Public leaderboard, player-list, club-list and season responses come from a
cache in memory that is refreshed in the background (`cache/public-data-cache.ts`)
and read again at start. Club logos given as a link are cached under
`.cache/club-logos` in the API's working directory (`apps/api/.cache/` locally,
`/app/.cache` in the container, a named Docker volume in production); they are
runtime data, not source data. Account/profile responses use `no-store`. Season
responses also use `no-store`: season data remains cached internally, but
`server_now_utc` is generated at response time for countdown synchronization.

Discord OAuth requests `identify` and `guilds.members.read`, checks membership
in the configured guild, and sets a signed HTTP-only session cookie (with the
member's server nickname at login). The access token is used only during the
callback and never stored. The main navigation's last button, LOGIN (after
PARTNERS, `rel="nofollow"`, active on the account's pages `/profile` and `/my-club`), is static and starts the
login; without a configured login it leads to the profile page's explanation.
Signed in (`/api/auth/me`), `features/nav/nav.ts` turns it into the account
button: the member's Discord avatar covers its login figure, and a click opens
the links the account carries (`account_links`: ADMIN PANEL for an admin, nothing for
anyone else), MY PROFILE, MY CLUB (while `my_club` says My Club is open for the member) and LOGOUT; the
menu is built once, with every entry. All six buttons stand 1px apart and shrink only where the
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

**Admins** (`modules/admin/`, [ADR 0011](adr/0011-hidden-admin-page.md)). `guard.ts`
is the one check for the admin page, its API, the menu link and My Club's mode
`admins`: a session whose member the server's member list shows with one of
`ADMIN_ROLE_IDS` and who holds the role now (bot token, cached
`ADMIN_ROLE_CACHE_TTL_MS`; a change asks without the cache), for as long as the
login lasts. Anything else, a Discord failure included, is no. `/api/admin/*` routes sit in one plugin whose
first hook is the guard and answer a refusal with the standard 404 (`sendNotFound`,
no rate limit headers); `/internal/admin-gate` answers nginx (204/401) and is not
reachable from outside. The audit log is `dbo.WebsiteAdminAudit`
(`audit-repository.ts`). Off unless `ADMIN_ENABLED` and
complete (`.env.example`). The Admin Panel moderates clubs (club management B2): it lists every
club with its backend id, and renames one (name and/or tag, the shared rules, unique), removes its
logo or deletes it, through the club service (`management.ts` `admin*`, rules in `rules.ts`) while
My Club is in mode `admins` or `on`; each action is a `club.*` line in the audit log with what was
asked and how it ended (`features/admin/admin-clubs.ts` draws it, only in the private bundle).

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
`SortOrder` (the WFC titles first, then the developer titles), Free Titles always
last (a new category falls in before them); MSL in
groups X-TIME WORLD CHAMPION (5 down to 2), WORLD, FALL, SUMMER, SPRING CHAMPION,
each by year (newest first); season titles by year and season, the green
TOURNAMENT WINNER first, legacy ranks from the highest, Free Titles A–Z; the same
title in several games MSBL, MSC, SMS; equal ranks by code. `rules.ts` awards from
existing data, each title in its game: a season's Strikers Titans (reward level
5/5, once the season is completed; the season's title of that game is created
then), MSL event winners (the template creates the game variant), counts of MSL
World Championships and of clear non-MSL wins in one game, the fixed titles (WFC
records, RECHARGED DEV in #bfff72) to their owners (player and Discord id), and the
highest legacy rank held when the
competitive ranks began (no game). Unclear data awards nothing and is reported. The
API runs the rules once a day (`TITLE_SYNC_INTERVAL_MS`; the last run is logged in
`dbo.CommandLog`); `npm run ops:player-titles` adds the titles of `catalog.ts` the
database lacks, `npm run ops:title-sync` awards on demand (a dry run without
`-- --apply`); `npm run ops:title-test-unlocks` grants
or revokes a player's test unlocks. A new title of a known kind is one row in
`dbo.PlayerTitle` (or a line in `catalog.ts` plus `ops:player-titles`).

**Club management** ([ADR 0012](adr/0012-club-management-on-the-website.md),
`modules/clubs/`; being built). Clubs are managed on the website only ("My Club");
Robotic Nightmare performs the effects (DMs, nickname tags, #club-transfers posts)
from the outbox `dbo.ClubEvent`. `rules.ts` holds every rule once, as pure decisions:
a change reads the clubs it touches under locks (`management-repository.ts`; club rows
first, then roster, invitations, player state, rejoin blocks; a deadlock runs it
again, at most twice), the decision answers with a plan (the writes and the bot's events, `events.ts`)
or a refusal, and the store applies the plan in the same transaction.
`management.ts` is the service behind `/api/my-club`: the member from the session, the
mode of `dbo.ClubSystemState` (`off`, `admins` = confirmed admins only, `on`; cached
30 s for reads, read again under the lock of every change), the member's server
membership asked live on every change (refused when Discord cannot be asked), the
request checked by `packages/shared/src/clubs.ts`. An uploaded logo
([ADR 0013](adr/0013-club-logo-uploads-with-sharp.md), `logo-upload.ts`) is checked
(type from its bytes, 2 MB, 256–2048 px, no animation), decoded and re-encoded with
sharp as a 512 px WebP without metadata (`logo-image.ts`; a link logo gets the same
rendition when `logo-cache.ts` downloads it), and stored in `dbo.ClubLogo`; the logo route
serves it before a link logo (`uploaded-logos.ts` knows which clubs have one, read once
a minute and after every change), and `Club.Logo` gets its public URL. The server's
member list (`integrations/discord/guild-members.ts`, read with the bot token at start
and every five minutes in the background, so no request waits for Discord) answers who
is on the server for the invite list, succession and the absence rule, and gives club
rosters and the profile editor the members' current names. `/internal/clubs/invitations/:id/answer` takes the bot's Accept/Decline buttons
with the shared `CLUB_INTERNAL_SECRET` (404 otherwise; nginx never proxies `/internal/`).
`lifecycle.ts` runs every `CLUB_LIFECYCLE_INTERVAL_MS` (default 5 minutes; `dev:live`
sets 0): invitations expire, the new-club counter marks clubs alone 30 days after
creation inactive and deletes them 14 days later, and from go-live members off the
server are removed after 14 days and club activity follows the members' rated matches.
The public list shows a club the counter marked inactive as inactive. The schema
(added 2026-11-19): `dbo.Club` has `PublicId` (the backend club id) and the
timestamps of the new-club counter, `dbo.ClubRoster` the join date and the absence
stamp, and own tables hold the mode (`dbo.ClubSystemState`), invitations, per-player
state, rejoin blocks, the outbox (`dbo.ClubEvent`) and uploaded logos. The game's
value lists and the name, tag and id rules live in `packages/shared/src/clubs.ts`.
The page `/my-club` (`apps/web/src/features/my-club/`) shows the member's club on the club
popup's card (`features/clubs/club-profile-view.ts`, shared with the popup) and edits its settings
the profile page's way (`club-edit.ts`; the save bar `features/profile/edit-bar.ts` and the
account panels `account-page.ts` are shared with My Profile); without a club it shows the member's
invitations, creating a club and the open clubs.

Responses use snake_case keys throughout; code inside the API uses camelCase
and converts at the route (the season route shows how, since its cached
data keeps the service's shape).

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
| `cache/`, `db/`, `http/`, `integrations/`, `lib/` | Public data cache, SQL statements and the database (ADR 0014), reply helpers and errors, Discord REST, small utilities |
| `ops/` | Maintenance commands (`npm run ops:*` in `apps/api`): `check-db`, `player-titles`, `title-sync`, `title-test-unlocks` |

A new endpoint goes into the module of its domain: SQL in `repository.ts` (`sql` templates),
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
addresses; uploaded ones are never passed through, only re-encoded.

## API reference

All endpoints below use the same origin as the website.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/leaderboards/:game/:mode?limit=100&offset=0` | Ranked rows |
| GET | `/api/leaderboards/:game/:mode/top?limit=25` | Top ranked rows |
| GET | `/api/clubs/msbl` (alias `/api/clubs`) | Club list |
| GET | `/api/clubs/msbl/:clubId/profile` | Club details and roster |
| GET | `/api/clubs/msbl/:clubId/logo` | Club image: the uploaded logo (immutable under `?v=<hash>`), else the cached link image |
| GET | `/api/players` | Player list |
| GET | `/api/players/:playerId/profile` | Player profile |
| GET | `/api/competitive-season/current` | Current competitive season |
| GET | `/api/events/community` | Community events |
| GET | `/api/wiimmfi/msc-charged` | Online MSC players |
| GET | `/api/auth/discord/start?returnTo=/profile` | Begin login |
| GET | `/api/auth/discord/callback` | Complete login |
| GET | `/api/auth/me` | Current login state, whether login is available, an admin's `account_links`, and `my_club` while My Club is open for the member |
| POST | `/api/auth/logout` | Clear session |
| GET | `/api/profile/me` | Authenticated user's linked profile |
| POST | `/api/profile/me` | Create the authenticated user's profile when the login could not |
| GET | `/api/profile/me/editable` | The editor's profile: Discord names, title, country, friend codes, the member's titles, countries |
| GET | `/api/profile/me/stats` | MY PROFILE's statistics per game (MSBL, MSC, SMS) of the signed-in player; `null` for a value not available |
| PUT | `/api/profile/me/editable` | Save the editor's title, country and friend codes (JSON, with `version`) |
| GET | `/api/my-club` | My Club: the signed-in member's club (role, permissions, roster, settings, its open invitations), the member's invitations, whether they may create a club |
| POST | `/api/my-club/create` | Create a club (JSON: name, tag and the settings) |
| PUT | `/api/my-club/settings` | Save the club's settings (JSON, with `settings_version` as `version`) |
| POST | `/api/my-club/join` | Join an open club (JSON: `club_id`) |
| POST | `/api/my-club/leave` | Leave the club |
| POST | `/api/my-club/members/:playerId/remove` | Remove a member |
| PUT | `/api/my-club/members/:playerId/officer` | Promote or demote (JSON: `officer`) |
| GET | `/api/my-club/invite-candidates?q=&page=` | Players the club can invite: a profile, no club, on the server |
| POST | `/api/my-club/invitations` | Invite a player (JSON: `player_id`) |
| DELETE | `/api/my-club/invitations/:invitationId` | Revoke an invitation |
| POST | `/api/my-club/invitations/:invitationId/accept` | Accept an invitation (also `.../decline`) |
| PUT | `/api/my-club/logo` | Upload the club's logo (the raw image as the body: `image/png`, `image/jpeg` or `image/webp`, at most 2 MB) |
| DELETE | `/api/my-club/logo` | Remove the uploaded logo |
| POST | `/api/my-club/activity` | Confirm the club's activity |
| POST | `/api/my-club/delete` | Delete the club (JSON: `confirm_tag`, the exact tag) |
| GET | `/api/admin/overview` | Admin only (404 otherwise): the admin, the access window, the latest admin activity |
| GET | `/api/admin/clubs` | Admin only: every club with its backend id, members and logo, and the club mode |
| POST | `/api/admin/clubs/:clubId/rename` | Admin only: a club's new name and/or tag (JSON: `name`, `tag`), logged |
| DELETE | `/api/admin/clubs/:clubId/logo` | Admin only: remove a club's logo, logged |
| POST | `/api/admin/clubs/:clubId/delete` | Admin only: delete a club (JSON: `confirm_tag`, the exact tag), logged |
| GET | `/api/health` | Service health |

Leaderboard games are `msbl`, `msc` and `sms`; modes are `elo1v1`,
`elo2v2` and `whr`. The tab strip offers `elo1v1` and `whr` for all three
games; the `msbl-elo2v2` page and route still exist but have no tab.
WHR is the all-time 1v1 rating that futbot recalculates from every reported
result; the backend only reads it.
The route modules in `apps/api/src/modules/` and their tests define response
fields and validation.
