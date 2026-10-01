# Development

## Everyday setup

Use Node.js 24 LTS. From the repository root, run `npm ci`, then `npm run dev`.
Open **http://localhost:8787**. The Astro development server serves the site
and forwards `/api` to the API on port 8788. API code changes restart the API;
frontend changes need a browser refresh. `npm run preview` serves the production
build instead. Both use the shared routing, so clean URLs, redirects and 404s
match the live site.

The development runner uses invented players, clubs, rankings, season data,
events and Wiimmfi results from `apps/api/src/fixtures/data-source.ts`. It does not
require or use production credentials. Login with Discord is simulated locally:
you can inspect a sample account and log out without contacting Discord; the
second sample account has no profile and gets a new one at login. Changes made
on the profile page are kept in memory until the API restarts. It does not validate real OAuth, guild
membership or live database behavior.

`npm run dev` selects fixtures explicitly; `npm start` remains the live API
entrypoint. Production rejects fixture mode.

From the repository root, `docker compose up --build` is an optional local
alternative at **http://localhost:8080**. It uses fixtures and needs no `.env`,
and serves the site as built into the image: rerun it with `--build` after changes.
Stop its services with `docker compose down`.

## Live integrations

Live integration work is optional and coordinated with GoldCobra. Use separate
development credentials and permitted test data; do not copy a production
database or account secrets into fixtures.

Copy `apps/api/.env.example` to `apps/api/.env` with your editor or file manager.
Fill only the settings needed for the integration. The template and
`apps/api/src/config.ts` are the source of truth for names and defaults.

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

Run `npm run dev:live` from the repository root to serve the site and live API together
at **http://localhost:8787** (the API reads `apps/api/.env`). Missing service configuration may cause the
corresponding API calls to fail; other pages and browser save tools remain
available. A live database smoke check is `npm run ops:check-db --workspace=@ms/api`;
run it only when the intended database connection is configured.

## Checks and troubleshooting

Run the [README checks](../README.md#checks) before a pull request. Automated
checks use fixtures; verify visible changes manually on desktop and mobile.
Add tests for meaningful behavior changes rather than duplicating static text.

| Symptom | Action |
| --- | --- |
| Clean page URL or `/api/...` returns 404 | Use `npm run dev` or local Compose; generic static servers do not implement the routes. |
| The Gear Builder does not load | Open the HTTP URL instead of an HTML file on disk. |
| Changes look stale | Reload; after changing a Gear Builder file, bump its tag (`assets.ts` or `gear-builder-host.ts`). |
| Port already in use | Stop your earlier development server; the launcher does not terminate another application. |
| Live data/login fails | Check the configured integration and server logs; first confirm the equivalent page works with fixtures. |
| An exported save is rejected | Verify size, region and checksum rules in [save tools](save-tools.md). |

Keep `.env` files, caches, test reports and personal save files out of commits.
