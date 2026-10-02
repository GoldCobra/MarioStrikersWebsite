# Mario Strikers Community Website

Community guides, rankings and tools for Mario Strikers Battle League (MSBL),
Mario Strikers Charged (MSC) and Super Mario Strikers (SMS).

**Website:** [mariostrikers.gg](https://mariostrikers.gg) · **Development branch:** `gc-updates`

## What is here

- Setup guides, competitive rules, tier lists and community events.
- Live rankings, players, Striker Clubs and Discord-backed profiles with player titles.
- MSBL Gear Builder and save editor; MSC save and online friendlist editors.
  They read and export files locally in the browser and never upload saves.

## How it works

```text
Browser ──► Caddy (HTTPS) ──► nginx ──► static pages and assets     built from apps/web
                                  └──► /api/* ──► Fastify API       apps/api
                                                   ├─ MSSQL: rankings, players, clubs, seasons
                                                   ├─ Discord: login, member names, events
                                                   └─ FlareSolverr → Wiimmfi: online MSC players
```

- **Pages are static.** Astro renders every page to HTML at build time, with its
  navigation, metadata and text, so search engines read the whole site.
- **Live data loads in the browser.** Small TypeScript modules fetch rankings,
  profiles, clubs, events and countdowns from the API on the same origin.
- **One page registry** (`packages/shared/src/site/`) defines each page's URL,
  title, description, menu place and indexing. Navigation, sitemap, nginx
  routes, local servers and tests are derived from it.
- **Own code is TypeScript** in one npm workspace (the Gear Builder is a
  vendored snapshot). The API runs its sources directly on Node 24; Vite
  bundles the browser code with content-hashed names.

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
npm run build
npm run check:frontend   # checks the built site
npm test
npm run test:smoke
git diff --check
```

The checks and smoke tests use local fixtures and require no production secrets.
For visual changes, also check the affected page on desktop and mobile. The
[comparison checks](docs/testing.md) prove that pages, markup, API responses and
save editor exports stay identical to a reference commit, and that no page
breaks the Content Security Policy.

## Where things live

| Location | Contents |
| --- | --- |
| `packages/shared/src/` | Page registry (`site/pages.ts`), menu model (`site/navigation.ts`), routing and helpers shared by site and API |
| `apps/web/src/pages/` | One `.astro` file per page; page families (leaderboards, rules, tier lists) in `src/components/pages/` |
| `apps/web/src/content/` | Page content kept as typed data: competitive rules, tier lists, Gear Builder characters |
| `apps/web/src/features/` | Browser code, one folder per feature; `src/entries/` picks the features of each page type |
| `apps/web/src/styles/` | The global stylesheet as partials named after their component; `global.ts` fixes the order |
| `apps/web/public/assets/` | Images, fonts, sample saves and the Gear Builder snapshot, served as they are |
| `apps/api/src/modules/` | One folder per API domain: routes, service, SQL repository, tests |
| `tools/`, `tests/e2e/` | Local servers and project checks; comparison checks against a reference commit |
| `infra/nginx/`, `Caddyfile`, `Dockerfile.*` | Production web server and containers; `scripts/deploy.py` releases them |

[Architecture and API](docs/architecture.md) explains the parts in more
detail; the [architecture decisions](docs/adr/README.md) explain why they look
as they do.

## Contributing and releases

Create a short feature branch from `gc-updates` and open a pull request back
to it. **GoldCobra reviews and merges changes.** Merging does not deploy the site.

- [Contribution workflow](CONTRIBUTING.md)
- [Development and live services](docs/development.md)
- [Architecture and API](docs/architecture.md)
- [Architecture decisions](docs/adr/README.md)
- [Save tools and formats](docs/save-tools.md)
- [Testing and comparison checks](docs/testing.md)
- [Deployment and rollback](docs/deployment.md)
- [Gear Builder maintenance](docs/msbl-gear-builder-snapshot.md)

## Credits

- MSC Setup Guide: `@ImSpiker` ([source guide](https://docs.google.com/document/d/1a49tGOAVqi5mW9RqfZF3QanELxw8Ogsq4NQ068B8Zco/edit?tab=t.0)).
- SMS Setup Guide: `@Randomepicdude`.
- MSBL Gear Builder: `@wo0k`.
