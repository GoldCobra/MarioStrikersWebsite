# Mario Strikers Community Website

Static website for the Mario Strikers Community with a small read-only Node/Express API bridge for live community data.

The frontend is plain HTML, shared CSS, and browser JavaScript. Most pages are static shells that are populated by shared JS modules. Leaderboards, clubs, players, and player profiles call `/api/...`; the MSBL Save Editor, MSC Save Editor, and MSC Online Friendlist Editor run fully in the browser against files selected locally by the user.

## Features

- Global navigation, section navigation, page tabs, footer, and shared popup styling.
- Landing page with community links and countdown/content modules.
- Game sections for MSBL, MSC, and SMS.
- MSBL Gear Builder embedded from `assets/gear-builder/`.
- MSBL Gear Builder gear preset XML export for edited character builds.
- MSC setup guide and SMS setup guide.
- Competitive rules pages for MSBL, MSC, SMS, MSL, and community tournaments.
- Tier list pages for MSBL, MSC, and SMS.
- Live ELO/WHR leaderboards backed by MSSQL through the local API bridge.
- Players list, player profile popup, and MSBL Striker Clubs.
- Partners, About Us, and Privacy Policy pages.
- MSBL Save Editor for local `strkrs.save` files.
- MSC Save Editor for local `Strikers2` save files.
- MSC Online Friendlist Editor for local `Online` friend roster files.

## Tech Stack

- Frontend: static HTML in `index.html` and `pages/`.
- Styling: shared site CSS in `css/global.css`; Gear Builder CSS under `assets/gear-builder/`.
- Browser logic: vanilla JavaScript in `js/`.
- Backend: Node.js `>=20`, Express, MSSQL, read-only API endpoints.
- Data source: live MSSQL database. The backend does not store leaderboard, player, profile, or club data locally.

Cache busting is handled with `?v=...` query strings in HTML script/style URLs. Update the relevant tag when changing browser-loaded JS/CSS/assets that may be cached.

## Project Structure

```text
.
+-- index.html                         # Landing page
+-- pages/                             # Static website pages
|   +-- templates/                     # Browser-loaded HTML fragments
+-- css/global.css                     # Shared navigation, layout, tools, popups, responsive CSS
+-- js/                                # Navigation, tabs, leaderboards, players, clubs, rules, editors
+-- assets/                            # Runtime images, fonts, flags, icons, Gear Builder assets
|   +-- gear-builder/                  # Embedded MSBL Gear Builder source
|   +-- msc-saveeditor/                # MSC Save/Online Editor visual assets
+-- backend/                           # Express API bridge to MSSQL
+-- docs/                              # Notes, archived snapshots, non-runtime source assets
+-- start.bat                          # Windows local startup script
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

`start.bat` creates `backend/.env` from `.env.example` if missing, installs backend dependencies if `backend/node_modules/` is missing, starts the API, starts a static server with `/api` proxied to the API, and opens the frontend in the browser.

Manual start:

```powershell
# Terminal 1
cd backend
npm run start:api

# Terminal 2, project root
npx --yes http-server . -p 8080 -c-1 --proxy http://127.0.0.1:8787
```

Use a local server instead of opening HTML files directly, because templates and API requests use browser `fetch()`.

## Frontend Architecture

- Every page sets `body data-page="..."`.
- `js/global-nav.js` reads `data-page` and builds top navigation, section navigation, page tabs, external links, and the footer.
- `js/global-tabs-engine.js` handles tab sizing and interaction.
- Shared popup chrome lives in `css/global.css` via `popup-overlay`, `popup-card`, `popup-header`, `popup-title`, and `popup-close`.
- `js/runtime-config.js` defines `window.APP_RUNTIME_CONFIG.leaderboardsApiBase`.
  - Empty string means same-origin API calls such as `/api/leaderboards/...`.
  - Set it to a full API base URL if frontend and backend are hosted separately.
- Leaderboard pages use `js/leaderboards-config.js` and `js/leaderboards-engine.js`.
- Competitive rules pages use `js/competitive-rules-config.js` and `js/competitive-rules-engine.js`.
- Players and clubs use `js/players-engine.js` and `js/msbl-clubs-engine.js`.
- The player profile popup is loaded from `pages/templates/player-profile-popup.html`.
- The MSBL Gear Builder page loads `pages/templates/msbl-gear-builder.html` and scripts from `assets/gear-builder/`.
- MSBL Gear Builder preset drafts are stored in `sessionStorage` and can be exported as XML for the MSBL Save Editor.

## MSBL Save Editor

Page: `pages/msbl-save-editor.html`

Implemented by:

- `js/msbl-save-editor-contract.js`
- `js/msbl-save-editor.js`

No save file is uploaded to the backend. Files are read, patched, and exported locally in the browser.

Main behavior:

- Load a local `strkrs.save` file.
- Read and edit Coins as an unsigned 32-bit value.
- Import MSBL Gear Builder XML presets and apply edited character loadouts to the loaded save.
- Complete all Cups and unlock Bushido Gear.
- Apply Have All Gear for all 16 characters.
- Export the patched save file with the original byte length and filename.

Gear preset XML uses `<msbl-gear-presets version="1">` with one `<character id="..." name="..." build="1234" />` entry per edited character. Build digits are Head, Arms, Body, Legs using Gear Builder values `0..9`.

## MSC Save Editor

Page: `pages/msc-save-editor.html`

The page has two client-side modes:

- `SAVE (Strikers2)`
- `FRIENDLIST (Online)`

No save file or friendlist file is uploaded to the backend. Files are read, patched, and exported locally in the browser.

### SAVE (Strikers2)

Implemented by:

- `js/msc-save-editor-contract.js`
- `js/msc-save-editor.js`

Supported save file:

- Filename: `Strikers2`
- Size: `35616` bytes
- Regions: `R4QP01`, `R4QE01`, `R4QJ01`, `R4QK01`

Main behavior:

- Load a local `Strikers2` save.
- Detect region and validate file size/magic.
- Edit all 12 captain team presets.
- Pick captain and sidekicks through the visual roster UI.
- Write default competitive settings automatically through the contract.
- Import and export XML preset files.
- Export the patched save file; export applies the current in-browser draft before downloading.
- Recalculate the save header CRC32 at `0x0004-0x0007` over bytes `0x0008..EOF`.

### FRIENDLIST (Online)

Implemented by `js/msc-online-editor.js`.

Supported file:

- Filename: usually `Online`
- Profile headers: `R4QP`, `R4QE`, `R4QJ`, `R4QK`
- FriendData starts at `profileOffset + 0x1C`
- Friend names start at `profileOffset + 0x31C`
- Friend capacity: `64` entries per profile

Main behavior:

- Load a local `Online` file.
- Detect all MSC profiles and show them in the profile dropdown.
- Show profile name, region, own friend code, and roster count as `Friend Roster X/64`.
- Parse established friends and pending friend-key tokens.
- Display player names when stored in the file; pending entries fall back to `Pending Friend`.
- Calculate and display 12-digit friend codes in `####-####-####` format.

Friendcode algorithm:

- Profile ID is stored in the FriendData entry.
- Friendcode check value uses CRC8 over `PID little-endian + reversed game id`.
- The 12-digit friend key is `(checkValue << 32) | profileId`.

Friend roster editing:

- `ADD CODES`
  - Opens a global-style popup.
  - Accepts one friend code per line.
  - Accepted formats: `1234-5678-9012`, `123456789012`, `123456 789012`.
  - Invalid non-empty lines abort the whole add operation.
  - Own code, already-present codes, and duplicate pasted codes are skipped with a status summary.
  - Prevents exceeding `64/64`.
  - Writes new entries as pending friend-key tokens (`0x00001000`) and adds numeric pending labels.
- `DELETE CODES`
  - Opens a global-style popup with checkbox rows for every roster entry.
  - Deletes selected entries from the active profile only.
  - Rewrites FriendData compactly so there is no data after the first empty slot.
  - Rebuilds the friend-name block so names remain aligned with the remaining roster.
- `EXPORT ONLINE`
  - Downloads the patched `Online` file after add/delete changes.
  - Recalculates the header CRC32 at `0x0004-0x0007` over bytes `0x0008..EOF`.

Integrity behavior:

- Add/delete operations are done against an in-memory working copy.
- If patching, CRC update, or reparsing fails, the previous byte buffer is restored.
- Exported files keep the original byte length.

## Backend API

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

Current frontend leaderboard pages:

- MSBL: `elo1v1`, `elo2v2`, `whr`
- MSC: `elo1v1`, `whr`
- SMS: `elo1v1`, `whr`

## Main Routes

Top navigation:

- `index.html` - Home
- `pages/games.html` - Games
- `pages/competitive.html` - Competitive
- `pages/players.html` - Players
- `pages/partners.html` - Partners

Games:

- `pages/msbl.html` - MSBL Gear Builder
- `pages/msbl-save-editor.html` - MSBL Save Editor
- `pages/players-msbl-clubs.html` - MSBL Striker Clubs
- `pages/msc.html` - MSC overview
- `pages/msc-setup-guide.html` - MSC Setup Guide
- `pages/msc-save-editor.html` - MSC Save Editor and Online Friendlist Editor
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
- `pages/msbl-tier-lists.html`
- `pages/msc-tier-lists.html`
- `pages/sms-tier-lists.html`

Leaderboards:

- `pages/msbl-elo1v1.html`
- `pages/msbl-elo2v2.html`
- `pages/msbl-whr.html`
- `pages/msc-elo1v1.html`
- `pages/msc-whr.html`
- `pages/sms-elo1v1.html`
- `pages/sms-whr.html`

Utility/footer pages:

- `pages/about-us.html`
- `pages/privacy-policy.html`

Reserve/helper pages exist but are not central navigation targets, for example `pages/players-profiles.html`, `pages/msl-leaderboards.html`, and `pages/tab-placeholder.html`.

## Useful Commands

Backend syntax check:

```powershell
cd backend
npm run check
```

Frontend syntax checks for edited browser scripts:

```powershell
node --check js/global-nav.js
node --check js/msbl-gear-builder-host.js
node --check js/msbl-save-editor-contract.js
node --check js/msbl-save-editor.js
node --check assets/gear-builder/scripts/presets.js
node --check js/msc-save-editor.js
node --check js/msc-online-editor.js
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
- If templates fail to load, make sure the site is served through a local web server instead of opening files directly from disk.
- If static assets look stale, bump the relevant `?v=...` cache tag in the HTML file that loads the changed CSS or JS.
- If a patched `Strikers2` or `Online` file is rejected by the game, verify that the file length stayed unchanged and that the editor ran its CRC update before export.

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
