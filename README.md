# Mario Strikers Community Website

Current runtime is intentionally simple:
- Static frontend (`index.html`, `pages/*`, `css/global.css`, `js/*`)
- Read-only backend bridge (`backend/*`) that fetches live ratings directly from the Bot MSSQL source
- No Postgres, no local leaderboard storage
- One global cache tag for frontend includes: `20260424-final-cleanup-v1`

## API Contract (unchanged for frontend)

- `GET /api/leaderboards/:game/:mode?limit=100&offset=0`
- `GET /api/leaderboards/:game/:mode/top?limit=25`
- `GET /api/health`

Supported route values:
- `:game` in `sms | msc | msbl`
- `:mode` in `elo1v1 | elo2v2 | whr` (`elo2v2` currently surfaced in frontend for MSBL)

## Backend Setup

From `backend/`:

```powershell
npm install
copy .env.example .env
```

Set in `backend/.env`:
- `MSSQL_HOST`
- `MSSQL_PORT` (default `443`)
- `MSSQL_DATABASE`
- `MSSQL_USER`
- `MSSQL_PASSWORD`

Run backend:

```powershell
npm run start
```

Quick MSSQL test (reads top MSBL ELO 1v1 sample):

```powershell
npm run sync:mssql:once
```

## Local Start (Frontend + Backend)

From project root:

```powershell
start.bat
```

This opens:
1. Backend on `http://127.0.0.1:8787`
2. Frontend on `http://127.0.0.1:8080` with `/api` proxy to backend

## Notes

- All leaderboard data is read live from the Bot MSSQL source.
- No website-side database persistence is used.
- Existing frontend layout/leaderboard rendering remains unchanged.
- Source design files live under `docs/source-assets/` and legacy snapshots under `docs/archive/`; active runtime assets stay under `assets/`.

## Competitive Rules Content Mapping

Global competitive-rules pages use one shared template and styles in `css/global.css`.

- Wrapper and layout:
  - `main.page-content.competitive-rules-page`
  - `article.competitive-rules`
- Heading hierarchy:
  - Doc title -> `h1`
  - Main sections (`1`, `2`, `3`) -> `h2`
  - Subsections (`2.1`, `2.2`, `2.3`) -> `h3`
  - Detail sections (`2.1.1`, `2.2.1`, etc.) -> `h4`
- Typography contract:
  - Headings (`h1-h4`): `ITC Grizzly`
  - Body text (`p`, `li`, `a`): `Trade Gothic Next BdCn`
- Links:
  - Rule references and videos use `.cr-link`
  - Always external: `target=\"_blank\" rel=\"noopener noreferrer\"`

## Frontend Route Contract

Top-level pages:
- `index.html` (Home / Landing)
- `pages/games.html`
- `pages/competitive.html`
- `pages/players.html`
- `pages/partners.html`

Games section pages:
- `pages/msbl.html`
- `pages/msc.html`
- `pages/sms.html`
- `pages/msc-setup-guide.html`
- `pages/sms-setup-guide.html`

Leaderboard pages (canonical):
- `pages/msbl-elo1v1.html`
- `pages/msbl-elo2v2.html`
- `pages/msbl-whr.html`
- `pages/msc-elo1v1.html`
- `pages/msc-whr.html`
- `pages/sms-elo1v1.html`
- `pages/sms-whr.html`

Competitive section pages:
- `pages/msl.html`
- `pages/msl-league-rules.html`
- `pages/msl-leaderboards.html`
- `pages/msl-league-site.html`
- `pages/community-tournaments.html`

Game-specific utility pages:
- `pages/players-msbl-clubs.html` (used as `GAMES > MSBL > STRIKER CLUBS`)

Reserve pages (kept intentionally, currently not linked in active nav):
- `pages/players-profiles.html`
- `pages/msl-leaderboards.html`

Legacy alias routes have been removed. Use only the canonical leaderboard routes listed above.

Current routes:
- `pages/msc-competitiverules.html` (fully populated)
- `pages/msbl-competitiverules.html` (fully populated, shared template)
- `pages/sms-competitiverules.html` (fully populated, shared template)


