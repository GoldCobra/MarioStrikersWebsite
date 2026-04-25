# Mario Strikers Community Website

Static website for the Mario Strikers Community with a small read-only API bridge for live community data.

The frontend is plain HTML, CSS, and browser JavaScript. Dynamic pages call `/api/...`; in local development `start.bat` starts the backend and serves the static site with `/api` proxied to that backend.

## Features

- Landing page with global navigation and season countdown.
- Game pages for MSBL, MSC, and SMS.
- MSBL Gear Builder embedded from `assets/gear-builder/`.
- MSC Save Editor for local `Strikers2` save files and XML preset import/export.
- Setup guides for MSC and SMS.
- Competitive rules pages for MSBL, MSC, and SMS.
- Live leaderboards for ELO and WHR.
- Players list, player profile popup, and MSBL Striker Clubs.
- Partners and MSL information pages.

## Tech Stack

- Frontend: static HTML files in `index.html` and `pages/`.
- Styling: shared CSS in `css/global.css`, plus Gear Builder CSS under `assets/gear-builder/`.
- Browser logic: vanilla JavaScript in `js/`.
- Backend: Node.js `>=20`, Express, MSSQL.
- Data source: live MSSQL database. The backend does not store leaderboard, player, or club data locally.

Current frontend cache tag used in script/style URLs: `20260424-final-cleanup-v1`.

## Project Structure

```text
.
+-- index.html                # Landing page
+-- pages/                    # Static website pages
|   +-- templates/            # HTML fragments loaded by browser scripts
+-- css/global.css            # Shared layout, navigation, components, responsive styles
+-- js/                       # Navigation, tabs, leaderboards, players, clubs, tools
+-- assets/                   # Browser-loaded images, fonts, flags, Gear Builder assets
+-- backend/                  # Express API bridge to MSSQL
+-- docs/                     # Notes, source design files, archived snapshots
+-- start.bat                 # Windows local startup script
```

Files in `assets/` are runtime assets loaded by the website. Source design files belong in `docs/source-assets/`; old snapshots belong in `docs/archive/`.

## Local Development

Requirements:

- Node.js `>=20`
- `npm` and `npx` in PATH
- MSSQL credentials for `backend/.env`

Install backend dependencies and create the local config:

```powershell
cd backend
npm install
copy .env.example .env
```

Fill `backend/.env`:

```env
PORT=8787
CORS_ORIGIN=*
LEADERBOARD_DEFAULT_LIMIT=100
LEADERBOARD_MAX_LIMIT=500
MSSQL_HOST=
MSSQL_PORT=443
MSSQL_DATABASE=
MSSQL_USER=
MSSQL_PASSWORD=
```

Start the full local environment from the project root:

```powershell
start.bat
```

This starts:

- Frontend: `http://127.0.0.1:8080`
- Backend API: `http://127.0.0.1:8787`

`start.bat` also creates `backend/.env` from `.env.example` if it is missing, installs backend dependencies if `backend/node_modules/` is missing, and opens the frontend in the browser.

Manual start:

```powershell
# Terminal 1
cd backend
npm run start:api

# Terminal 2, project root
npx --yes http-server . -p 8080 -c-1 --proxy http://127.0.0.1:8787
```

Use a local server instead of opening HTML files directly, because templates and API requests use browser `fetch()`.

## How The Frontend Works

- Every page sets `body data-page="..."`.
- `js/global-nav.js` reads `data-page` and builds the top navigation, section navigation, and page tabs.
- `js/global-tabs-engine.js` handles tab sizing and interaction.
- `js/runtime-config.js` defines `window.APP_RUNTIME_CONFIG.leaderboardsApiBase`.
  - Empty string means same-origin API calls like `/api/leaderboards/...`.
  - Set it to a full API base URL if the frontend and backend are hosted separately.
- Leaderboard pages use `js/leaderboards-config.js` and `js/leaderboards-engine.js`.
- Competitive rules pages share `js/competitive-rules-config.js` and `js/competitive-rules-engine.js`.
- Players and clubs are rendered by `js/players-engine.js` and `js/msbl-clubs-engine.js`.
- The MSBL Gear Builder page loads `pages/templates/msbl-gear-builder.html` and scripts from `assets/gear-builder/`.
- The MSC Save Editor runs fully in the browser after the user selects a local save file.

## API

Local base URL: `http://127.0.0.1:8787`

```text
GET /api/leaderboards/:game/:mode?limit=100&offset=0
GET /api/leaderboards/:game/:mode/top?limit=25
GET /api/clubs/msbl
GET /api/players
GET /api/players/:playerId/profile
GET /api/health
```

Supported leaderboard values:

- `:game`: `msbl`, `msc`, `sms`
- `:mode`: `elo1v1`, `elo2v2`, `whr`

`elo2v2` exists in the API contract, but the current frontend only surfaces it for MSBL.

## Main Routes

Top navigation:

- `index.html` - Home
- `pages/games.html` - Games
- `pages/competitive.html` - Competitive
- `pages/players.html` - Players
- `pages/partners.html` - Partners

Games:

- `pages/msbl.html` - MSBL Gear Builder
- `pages/players-msbl-clubs.html` - MSBL Striker Clubs
- `pages/msc.html` - MSC overview
- `pages/msc-setup-guide.html` - MSC Setup Guide
- `pages/msc-save-editor.html` - MSC Save Editor
- `pages/sms.html` - SMS overview
- `pages/sms-setup-guide.html` - SMS Setup Guide

Competitive:

- `pages/msbl-competitiverules.html`
- `pages/msc-competitiverules.html`
- `pages/sms-competitiverules.html`
- `pages/msl.html`
- `pages/msl-league-rules.html`
- `pages/msl-league-site.html`
- `pages/community-tournaments.html`

Leaderboards:

- `pages/msbl-elo1v1.html`
- `pages/msbl-elo2v2.html`
- `pages/msbl-whr.html`
- `pages/msc-elo1v1.html`
- `pages/msc-whr.html`
- `pages/sms-elo1v1.html`
- `pages/sms-whr.html`

Some reserve/helper pages are present but not part of the active main navigation, for example `pages/players-profiles.html`, `pages/msl-leaderboards.html`, and `pages/tab-placeholder.html`.

## Useful Commands

Backend syntax check:

```powershell
cd backend
npm run check
```

MSSQL smoke test for a small MSBL ELO 1v1 sample:

```powershell
cd backend
npm run sync:mssql:once
```

Repository whitespace check:

```powershell
git diff --check
```

## Troubleshooting

- If dynamic pages show loading errors, check that the backend is running and `backend/.env` contains valid MSSQL credentials.
- If `/api/...` returns 404 from the frontend server, make sure the static server was started with the proxy shown above.
- If static assets look stale, update the shared cache tag in the HTML script/style URLs when changing frontend assets.

## Credits

- MSC Setup Guide: `@ImSpiker`
- SMS Setup Guide: `@Randomepicdude`
- MSBL Gear Builder: `@wo0k`

MSC source document: [Published MSC Setup Guide](https://docs.google.com/document/d/1a49tGOAVqi5mW9RqfZF3QanELxw8Ogsq4NQ068B8Zco/edit?tab=t.0)

## Related Docs

- `docs/competitive-rules-mapping.md`: competitive rules consolidation notes.
- `docs/msbl-gear-builder-snapshot.md`: MSBL Gear Builder snapshot and re-import notes.
- `docs/source-assets/`: non-runtime source design files.
- `docs/archive/`: retired files kept for reference.
