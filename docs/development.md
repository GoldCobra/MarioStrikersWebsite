# Development

## Everyday setup

Use Node.js 24 LTS. From `backend/`, run `npm ci`, then `npm run dev`.
Open **http://localhost:8787**. The server serves both the frontend and API;
backend code changes restart it, and frontend changes need a browser refresh.

The development runner uses invented players, clubs, rankings, season data,
events and Wiimmfi results from `backend/src/dev/fixtures.js`. It does not
require or use production credentials. Login with Discord is simulated locally:
you can inspect a sample account and log out without contacting Discord.
It does not validate real OAuth, guild membership or live database behavior.

`npm run dev` selects fixtures explicitly; `npm start` remains the live API
entrypoint. Production rejects fixture mode.

From the repository root, `docker compose up --build` is an optional local
alternative at **http://localhost:8080**. It uses fixtures and needs no `.env`.
Stop its services with `docker compose down`.

## Live integrations

Live integration work is optional and coordinated with GoldCobra. Use separate
development credentials and permitted test data; do not copy a production
database or account secrets into fixtures.

Copy `backend/.env.example` to `backend/.env` with your editor or file manager.
Fill only the settings needed for the integration. The template and
`backend/src/config.js` are the source of truth for names and defaults.

| Integration | Configuration |
| --- | --- |
| Database | `MSSQL_HOST`, `MSSQL_PORT`, `MSSQL_DATABASE`, `MSSQL_USER`, `MSSQL_PASSWORD` |
| Discord login | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, `DISCORD_GUILD_ID`, `SESSION_SECRET` |
| Discord names/events | `DISCORD_BOT_TOKEN`, guild/category settings in the template |
| Wiimmfi | Reachable FlareSolverr instance at `FLARESOLVERR_URL` |

Register the exact local callback
`http://localhost:8787/api/auth/discord/callback` for a development Discord
application. HTTP development uses `SESSION_COOKIE_SECURE=false`; production
uses secure cookies over HTTPS.

Run `npm run dev:live` from `backend/` to serve the site and live API together
at **http://localhost:8787**. Missing service configuration may cause the
corresponding API calls to fail; other pages and browser save tools remain
available. A live database smoke check is `npm run sync:mssql:once`; run it
only when the intended database connection is configured.

## Checks and troubleshooting

Run the [README checks](../README.md#checks) before a pull request. Automated
checks use fixtures; verify visible changes manually on desktop and mobile.
Add tests for meaningful behavior changes rather than duplicating static text.

| Symptom | Action |
| --- | --- |
| Clean page URL or `/api/...` returns 404 | Use `npm run dev` or local Compose; generic static servers do not implement the routes. |
| Page templates fail to load | Open the HTTP URL instead of an HTML file on disk. |
| Changes look stale | Reload and update relevant browser asset `?v=...` references. |
| Port already in use | Stop your earlier development server; the launcher does not terminate another application. |
| Live data/login fails | Check the configured integration and server logs; first confirm the equivalent page works with fixtures. |
| An exported save is rejected | Verify size, region and checksum rules in [save tools](save-tools.md). |

Keep `.env` files, caches, test reports and personal save files out of commits.
