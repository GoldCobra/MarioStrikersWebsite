# Mario Strikers Community Website

Community guides, rankings and tools for Mario Strikers Battle League (MSBL),
Mario Strikers Charged (MSC) and Super Mario Strikers (SMS).

**Website:** [mariostrikers.gg](https://mariostrikers.gg)

**Repository:** [GoldCobra/MarioStrikersWebsite](https://github.com/GoldCobra/MarioStrikersWebsite)

**Development branch:** `gc-updates`

## What is here

- Setup guides, competitive rules, tier lists and community events.
- Live rankings, players, Striker Clubs and Discord-backed profiles.
- MSBL Gear Builder and save editor.
- MSC save and online friendlist editors.

Save tools read and export files locally in the browser. They do not upload saves.

## Quick start

Install **Node.js 24 LTS**, including npm, and Git. The same commands work in
PowerShell, macOS and Linux terminals:

```sh
git clone --branch gc-updates https://github.com/GoldCobra/MarioStrikersWebsite.git
cd MarioStrikersWebsite
npm ci
npm run dev
```

Open **http://localhost:8787**. This serves the website (Astro development
server) and the API (port 8788) with synthetic sample data; no database,
Discord account, Docker or `.env` file is required. The local login flow is
simulated and does not authenticate with Discord. Stop it with Ctrl+C. API
changes restart the API; reload the browser after frontend changes.

`npm run preview` builds the site and serves the production build the same way,
with production routing.

Optional Docker development, from the repository root:

```sh
docker compose up --build
```

Open **http://localhost:8080**. Docker also uses sample data. Stop it with
`docker compose down`. See [development details](docs/development.md) for
live service configuration and troubleshooting.

## Checks

Run these commands from the repository root before opening a pull request:

```sh
npm run check
npm run check:frontend
npm test
npm run test:smoke
git diff --check
```

The checks and smoke tests use local fixtures and require no production secrets.
For visual changes, also check the affected page on desktop and mobile. The
[comparison checks](docs/testing.md) prove that pages, markup and API responses
stay identical to a reference commit.

## Project layout

| Location | Purpose |
| --- | --- |
| `apps/web/` | Astro site; `public/` holds page shells, styles, browser scripts and assets |
| `apps/api/` | Express API, service integrations, fixtures and tests |
| `packages/shared/` | Page registry, navigation model and URL routing used everywhere |
| `tools/` | Local servers, the nginx route generator and their tests |
| `tests/e2e/` | Comparison checks against a reference commit |
| `infra/nginx/` | Production web server configuration |
| `docs/` | Development notes, tool formats and design sources |

The repository is an npm workspace; one `npm ci` at the root installs everything.
The pages are still plain HTML, CSS and JavaScript, built with Astro. One
shared routing function serves clean URLs locally; production nginx mirrors it.
Production uses Caddy, Nginx and Express;
MSSQL provides community data, with local caches for public data and club logos.

## Contributing and releases

Create a short feature branch from `gc-updates` and open a pull request back
to it. **GoldCobra reviews and merges changes.** Merging does not deploy the site.

- [Contribution workflow](CONTRIBUTING.md)
- [Architecture and API](docs/architecture.md)
- [Save tools and formats](docs/save-tools.md)
- [Testing and comparison checks](docs/testing.md)
- [Deployment and rollback](docs/deployment.md)
- [Gear Builder maintenance](docs/msbl-gear-builder-snapshot.md)

## Credits

- MSC Setup Guide: `@ImSpiker` ([source guide](https://docs.google.com/document/d/1a49tGOAVqi5mW9RqfZF3QanELxw8Ogsq4NQ068B8Zco/edit?tab=t.0)).
- SMS Setup Guide: `@Randomepicdude`.
- MSBL Gear Builder: `@wo0k`.
